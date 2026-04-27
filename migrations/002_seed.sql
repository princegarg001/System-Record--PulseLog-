-- NevUp Track 1 — Seed Data Loader
-- Migration: 002_seed.sql
-- This file is auto-run on first DB start via docker-entrypoint-initdb.d
-- The actual seed data is loaded programmatically via the seed script

-- Insert seed users (from nevup_seed_dataset.json groundTruthLabels)
INSERT INTO users (user_id, name) VALUES
  ('f412f236-4edc-47a2-8f54-8763a6ed2ce8', 'Alex Mercer'),
  ('fcd434aa-2201-4060-aeb2-f44c77aa0683', 'Jordan Lee'),
  ('84a6a3dd-f2d0-4167-960b-7319a6033d49', 'Sam Rivera'),
  ('4f2f0816-f350-4684-b6c3-29bbddbb1869', 'Casey Kim'),
  ('75076413-e8e8-44ac-861f-c7acb3902d6d', 'Morgan Bell'),
  ('8effb0f2-f16b-4b5f-87ab-7ffca376f309', 'Taylor Grant'),
  ('50dd1053-73b0-43c5-8d0f-d2af88c01451', 'Riley Stone'),
  ('af2cfc5e-c132-4989-9c12-2913f89271fb', 'Drew Patel'),
  ('9419073a-3d58-4ee6-a917-be2d40aecef2', 'Quinn Torres'),
  ('e84ea28c-e5a7-49ef-ac26-a873e32667bd', 'Avery Chen')
ON CONFLICT (user_id) DO NOTHING;

-- Initialize user_metrics rows for all users
INSERT INTO user_metrics (user_id) VALUES
  ('f412f236-4edc-47a2-8f54-8763a6ed2ce8'),
  ('fcd434aa-2201-4060-aeb2-f44c77aa0683'),
  ('84a6a3dd-f2d0-4167-960b-7319a6033d49'),
  ('4f2f0816-f350-4684-b6c3-29bbddbb1869'),
  ('75076413-e8e8-44ac-861f-c7acb3902d6d'),
  ('8effb0f2-f16b-4b5f-87ab-7ffca376f309'),
  ('50dd1053-73b0-43c5-8d0f-d2af88c01451'),
  ('af2cfc5e-c132-4989-9c12-2913f89271fb'),
  ('9419073a-3d58-4ee6-a917-be2d40aecef2'),
  ('e84ea28c-e5a7-49ef-ac26-a873e32667bd')
ON CONFLICT (user_id) DO NOTHING;
