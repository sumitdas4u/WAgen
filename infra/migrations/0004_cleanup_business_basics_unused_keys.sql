-- Remove legacy/unused onboarding keys from JSON business_basics payloads.
-- Keeps only keys currently used by API/web logic.

UPDATE users
SET business_basics = COALESCE(
  (
    SELECT jsonb_object_agg(entry.key, entry.value)
    FROM jsonb_each(users.business_basics) AS entry(key, value)
    WHERE entry.key = ANY (
      ARRAY[
        'companyName',
        'whatDoYouSell',
        'targetAudience',
        'usp',
        'objections',
        'defaultCountry',
        'defaultCurrency',
        'greetingScript',
        'availabilityScript',
        'objectionHandlingScript',
        'bookingScript',
        'feedbackCollectionScript',
        'complaintHandlingScript',
        'supportEmail',
        'aiDoRules',
        'aiDontRules',
        'websiteUrl',
        'manualFaq',
        'agentObjectiveType',
        'agentTaskDescription'
      ]::text[]
    )
  ),
  '{}'::jsonb
);

UPDATE agent_profiles
SET business_basics = COALESCE(
  (
    SELECT jsonb_object_agg(entry.key, entry.value)
    FROM jsonb_each(agent_profiles.business_basics) AS entry(key, value)
    WHERE entry.key = ANY (
      ARRAY[
        'companyName',
        'whatDoYouSell',
        'targetAudience',
        'usp',
        'objections',
        'defaultCountry',
        'defaultCurrency',
        'greetingScript',
        'availabilityScript',
        'objectionHandlingScript',
        'bookingScript',
        'feedbackCollectionScript',
        'complaintHandlingScript',
        'supportEmail',
        'aiDoRules',
        'aiDontRules',
        'websiteUrl',
        'manualFaq',
        'agentObjectiveType',
        'agentTaskDescription'
      ]::text[]
    )
  ),
  '{}'::jsonb
);
