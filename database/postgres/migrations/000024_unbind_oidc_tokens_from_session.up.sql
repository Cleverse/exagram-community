BEGIN;

-- Tokens issued before expiresWithSession went false carry the flag in their stored payload, and
-- oidc-provider honours the stored value on find and copies it on rotation.
-- The adapter stores the payload as a jsonb string scalar holding the JSON text, so decode, strip, re-encode.
UPDATE "exagram"."oidc_payloads"
SET payload = to_jsonb((((payload #>> '{}')::jsonb) - 'expiresWithSession')::text)
WHERE type IN ('AccessToken', 'RefreshToken', 'AuthorizationCode')
  AND jsonb_typeof(payload) = 'string'
  AND ((payload #>> '{}')::jsonb) ? 'expiresWithSession';

UPDATE "exagram"."oidc_payloads"
SET payload = payload - 'expiresWithSession'
WHERE type IN ('AccessToken', 'RefreshToken', 'AuthorizationCode')
  AND jsonb_typeof(payload) = 'object'
  AND payload ? 'expiresWithSession';

COMMIT;
