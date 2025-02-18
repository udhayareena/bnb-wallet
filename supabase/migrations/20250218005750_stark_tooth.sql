/*
  # Add bonus tracking tables

  1. New Tables
    - `user_stats`
      - Tracks user statistics like referral counts and community size
    - `user_bonuses`
      - Records all bonus transactions and their types
  
  2. Security
    - Enable RLS on both tables
    - Add policies for users to read their own data
*/

-- User Statistics Table
CREATE TABLE IF NOT EXISTS user_stats (
    user_id bigint PRIMARY KEY REFERENCES wallet_users(user_id),
    direct_referrals_count integer DEFAULT 0,
    community_size integer DEFAULT 0,
    updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can read their own stats"
    ON user_stats
    FOR SELECT
    TO public
    USING (user_id IN (
        SELECT user_id FROM wallet_users WHERE wallet_address = auth.jwt()->>'sub'
    ));

-- Bonus Transactions Table
CREATE TABLE IF NOT EXISTS user_bonuses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id bigint REFERENCES wallet_users(user_id),
    bonus_type text NOT NULL,
    amount numeric(20,8) NOT NULL,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT valid_bonus_type CHECK (
        bonus_type IN (
            'direct',
            'referral',
            'upgrade',
            'level_up',
            'royalty',
            'reward'
        )
    )
);

-- Enable RLS
ALTER TABLE user_bonuses ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can read their own bonuses"
    ON user_bonuses
    FOR SELECT
    TO public
    USING (user_id IN (
        SELECT user_id FROM wallet_users WHERE wallet_address = auth.jwt()->>'sub'
    ));

-- Create function to update user stats
CREATE OR REPLACE FUNCTION update_user_stats()
RETURNS trigger AS $$
BEGIN
    -- Update direct referrals count
    INSERT INTO user_stats (user_id, direct_referrals_count)
    VALUES (NEW.referrer_id, 1)
    ON CONFLICT (user_id)
    DO UPDATE SET 
        direct_referrals_count = user_stats.direct_referrals_count + 1,
        updated_at = now();
    
    -- Update community size for all upline
    WITH RECURSIVE upline AS (
        -- Base case: start with the direct referrer
        SELECT referrer_id, 1 as level
        FROM wallet_users
        WHERE user_id = NEW.user_id
        
        UNION ALL
        
        -- Recursive case: get all upline referrers
        SELECT w.referrer_id, u.level + 1
        FROM wallet_users w
        INNER JOIN upline u ON w.user_id = u.referrer_id
        WHERE w.referrer_id IS NOT NULL
        AND u.level < 12  -- Limit to 11 levels up
    )
    UPDATE user_stats
    SET 
        community_size = community_size + 1,
        updated_at = now()
    WHERE user_id IN (SELECT referrer_id FROM upline);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update stats on new user
CREATE TRIGGER update_stats_on_new_user
    AFTER INSERT ON wallet_users
    FOR EACH ROW
    EXECUTE FUNCTION update_user_stats();