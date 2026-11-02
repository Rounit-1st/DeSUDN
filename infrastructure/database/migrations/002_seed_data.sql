-- Migration: 002_seed_data.sql
-- Seed initial publisher and software

INSERT INTO publishers (id, username, password_hash, public_key)
VALUES (
    'pub-demo-01',
    'admin',
    '$2a$10$vI8aWBnW3fID.ZQ4/zo1G.q1pB6/hR23xX9Jz1i8X0fX8LhTnmf9G', -- password: password123
    '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAx5s2bY62V792s/6P5V4e9j4v2Y0N/b2L4U2h+z9b7L4=\n-----END PUBLIC KEY-----'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO software (id, name, description, publisher_id)
VALUES (
    'desudn-demo-app',
    'DeSUDN Demonstration CLI',
    'A sample decentralized update test binary',
    'pub-demo-01'
)
ON CONFLICT (id) DO NOTHING;
