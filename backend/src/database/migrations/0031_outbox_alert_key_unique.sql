-- Tableau ETL alerts: one outbox row per (alert, ALERTS channel), deduplicated by the
-- database so two workers enqueueing the same alert cannot send it twice.
-- `sourceMessageId` is not reused for this: the dispatcher sends it to Rocket.Chat as
-- the thread id (`tmid`) of a real message, which an ETL alert does not have.
CREATE UNIQUE INDEX IF NOT EXISTS "outbox_alert_key_unique"
  ON "outbox_events" (("payload"->>'alertKey'), ("payload"->>'channelId'))
  WHERE "event_type" = 'rocketchat.message.send' AND "payload" ? 'alertKey';
