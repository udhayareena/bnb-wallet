/*
  # Create packages table and add initial package data

  1. New Tables
    - `packages`
      - `id` (uuid, primary key)
      - `name` (text, unique)
      - `bnb_amount` (numeric)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on `packages` table
    - Add policy for public read access
*/

CREATE TABLE IF NOT EXISTS packages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text UNIQUE NOT NULL,
    bnb_amount numeric(10,6) NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;

-- Create policy for public read access
CREATE POLICY "Anyone can read packages"
    ON packages
    FOR SELECT
    TO public
    USING (true);

-- Insert package data
INSERT INTO packages (name, bnb_amount) VALUES
    ('Bronze Builder', 0.002200),
    ('Silver Summit', 0.003300),
    ('Golden Achiever', 0.006600),
    ('Platinum Pioneer', 0.013200),
    ('Diamond Elite', 0.026400),
    ('Ruby Ruler', 0.052800),
    ('Sapphire Star', 0.105600),
    ('Emerald Emissary', 0.211200),
    ('Royal Ambassador', 0.422400),
    ('Master Mentor', 0.844800),
    ('Crown Commander', 1.689600),
    ('Supreme Visionary', 3.379200);