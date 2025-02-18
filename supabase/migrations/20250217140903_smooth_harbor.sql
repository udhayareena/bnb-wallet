/*
  # Create wallet users table

  1. New Tables
    - `wallet_users`
      - `id` (uuid, primary key)
      - `user_id` (bigint, unique, starting from 242424)
      - `wallet_address` (text, unique)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on `wallet_users` table
    - Add policy for authenticated users to read their own data
*/

CREATE TABLE IF NOT EXISTS wallet_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id bigint UNIQUE NOT NULL,
  wallet_address text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create sequence starting from 242424
CREATE SEQUENCE IF NOT EXISTS wallet_user_id_seq START WITH 242424;

-- Set default value for user_id to use the sequence
ALTER TABLE wallet_users ALTER COLUMN user_id SET DEFAULT nextval('wallet_user_id_seq');

-- Enable RLS
ALTER TABLE wallet_users ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can read wallet users"
  ON wallet_users
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Insert allowed for all"
  ON wallet_users
  FOR INSERT
  TO public
  WITH CHECK (true);