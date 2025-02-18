CREATE OR REPLACE FUNCTION get_referral_tree(root_user_id bigint)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
    result json;
BEGIN
    WITH RECURSIVE referral_tree AS (
        -- Base case: root node
        SELECT 
            w.user_id,
            w.referral_id,
            1 as level
        FROM wallet_users w
        WHERE w.user_id = root_user_id

        UNION ALL

        -- Recursive case: get children
        SELECT 
            w.user_id,
            w.referral_id,
            rt.level + 1
        FROM wallet_users w
        INNER JOIN referral_tree rt ON w.referrer_id = rt.user_id
        WHERE rt.level < 12  -- Limit to 12 levels
    )
    SELECT json_build_object(
        'userId', rt.user_id,
        'referralId', rt.referral_id,
        'children', COALESCE(
            json_agg(
                json_build_object(
                    'userId', c.user_id,
                    'referralId', c.referral_id,
                    'children', '[]'::json
                )
            ) FILTER (WHERE c.user_id IS NOT NULL),
            '[]'::json
        )
    )
    INTO result
    FROM referral_tree rt
    LEFT JOIN wallet_users c ON c.referrer_id = rt.user_id
    WHERE rt.user_id = root_user_id
    GROUP BY rt.user_id, rt.referral_id;

    RETURN result;
END;
$$;