INSERT INTO plans (code, name, price_monthly, monthly_credits, agent_limit, whatsapp_number_limit, status)
VALUES
  ('starter', 'Starter', 799, 300, 5, 1, 'active'),
  ('pro', 'Growth', 1499, 600, 10, 2, 'active'),
  ('business', 'Pro', 2999, 1200, 30, 3, 'active')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  price_monthly = EXCLUDED.price_monthly,
  monthly_credits = EXCLUDED.monthly_credits,
  agent_limit = EXCLUDED.agent_limit,
  whatsapp_number_limit = EXCLUDED.whatsapp_number_limit,
  status = EXCLUDED.status,
  updated_at = NOW();
