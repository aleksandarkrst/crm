-- CD-222: system entries on the deal timeline have no channel (they were "Research task" or the
-- stage's channel). "Task added" entries written before can't be matched to their task, so the
-- ones logged as research become system entries too.
UPDATE "activities" SET "channel" = NULL
WHERE "title" = 'Deal created'
   OR "title" LIKE 'Task removed: %'
   OR "title" LIKE 'Moved to %'
   OR ("title" LIKE 'Task added: %' AND "channel" = 'RS');
