# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Mindwtr tasks in Gladys, through the self-hosted sync server
  (`mindwtr-cloud`): a "Mindwtr" device with the tasks in the inbox, the next
  actions, the tasks waiting for someone, the overdue tasks, the tasks due
  today, the tasks done today and the next due date.
- Dashboard widget "Mindwtr: today": what is left for today, overdue first,
  with a button to mark each of the four most urgent tasks done.
- Scene triggers "Mindwtr task due", "Mindwtr task overdue" (at midnight),
  "Mindwtr inbox to review" (an item waited in the inbox for a delay chosen in
  the configuration) and "Mindwtr task added", with GTD list and title
  filters, and the task, its contexts, project and due date as variables.
- Scene actions "Add a task to the Mindwtr inbox" (with an optional due date,
  such as `tomorrow 18:30`, and contexts), "Mark a Mindwtr task done" (by
  title or id; repeating tasks move to their next occurrence) and "Read
  today's Mindwtr tasks" (a sentence for a message or a voice announcement).
- Counters and events on time at each due time, inbox review and local
  midnight, whatever the refresh interval (1 to 10 minutes).
