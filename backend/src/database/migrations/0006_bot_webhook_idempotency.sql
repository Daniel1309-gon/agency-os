CREATE UNIQUE INDEX "outbox_bot_source_message_unique"
  ON "outbox_events" (("payload"->>'sourceMessageId'))
  WHERE "event_type" = 'rocketchat.message.send' AND "payload" ? 'sourceMessageId';
