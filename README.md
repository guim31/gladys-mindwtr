# Mindwtr for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the tasks of [Mindwtr](https://github.com/dongdongbh/Mindwtr), the
free GTD app, into Gladys, through its **self-hosted sync server**
(`mindwtr-cloud`): the GTD counters, what is due today and overdue, the inbox
review as a scene trigger, and tasks captured or marked done from a scene or
the dashboard.

> **Feedback welcome.** The integration was checked against a real Mindwtr sync
> server (Docker image `ghcr.io/dongdongbh/mindwtr-cloud` 1.3.6, October 2026),
> but not yet in everyday use with a real Gladys. Please report what works and
> what does not in the [issues](https://github.com/guim31/gladys-mindwtr/issues).

## Features

- **A "Mindwtr" device** with seven features: _tasks in the inbox_, _next
  actions_, _waiting for_, _overdue tasks_, _tasks due today_, _tasks done
  today_ and the _next due date_ (text: the task and when).
- **Dashboard widget** "Mindwtr: today": two tiles, the list of what is left
  for today (overdue first, time, contexts) and a button to mark each of the
  four most urgent done.
- **Scene triggers**: _Mindwtr task due_, _Mindwtr task overdue_ (at
  midnight, the task of the day still not done), _Mindwtr inbox to review_
  (an item waited N hours in the inbox: the GTD review) and _Mindwtr task
  added_; filters on the GTD list and the title; the task, its id, list,
  contexts, project and due date as variables. Once each, across restarts.
- **Scene actions**: _Add a task to the Mindwtr inbox_ (title, optional due
  date such as `tomorrow 18:30` and contexts), _Mark a Mindwtr task done_ (by
  title or id; a repeating task moves to its next occurrence) and _Read
  today's Mindwtr tasks_ (a sentence for a message or a voice announcement).
- On time: besides the refresh interval (1 to 10 minutes, 5 by default), the
  integration reads the server at each due time, at the inbox review and at
  local midnight (the time zone of Gladys).
- A **Test the connection** button, a connection status that names the
  problem (token refused, the web app's port instead of the server's,
  certificate…), and a transport badge (`local` for a server at home, `cloud`
  for one on the Internet).
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- The **self-hosted Mindwtr sync server** `mindwtr-cloud`
  ([Docker guide](https://github.com/dongdongbh/Mindwtr/blob/main/docker/README.md)),
  reachable from Gladys, and one of its tokens (`MINDWTR_CLOUD_AUTH_TOKENS`,
  the token of the apps' Self-Hosted sync). **Dropbox, WebDAV, iCloud or
  file sync are not supported**: Mindwtr serves its REST API on this server
  only.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-mindwtr`
   (or install **Mindwtr** from the catalog once it is listed).
2. In **Configuration**, enter the Self-Hosted URL of your apps
   (`http://192.168.1.20:8787`, `https://mindwtr.example.org`…) and the sync
   token. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the **Mindwtr** device.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

The integration uses the REST API of the sync server, with the token in the
`Authorization: Bearer` header:

| Request                             | Use                                                    |
| ----------------------------------- | ------------------------------------------------------ |
| `GET /v1/tasks?limit=500&offset=N`  | open tasks (neither done, archived nor deleted)        |
| `GET /v1/tasks?status=done&all=1`   | done tasks, for "done today" (`all=1` is required)     |
| `GET /v1/projects`                  | project names, for the scene variables                 |
| `POST /v1/tasks` `{ title, props }` | add a task to the inbox (no quick-add parsing)         |
| `POST /v1/tasks/{id}/complete`      | mark a task done (repeating ones get a new occurrence) |

It **never reads nor writes `/v1/data`**, the whole document the apps
synchronize: the task routes take the server's write lock and merge like the
apps do, so a capture from Gladys cannot overwrite a sync in progress. The
server is read on a timer of the container; the device is published with
`should_poll: false`. States are published only when they change, and every 12
hours otherwise. The scene events are the moments (due time, end of the due
day, inbox review) crossed since the previous reading, plus the new task ids;
the time of the last reading, the open task ids and the last review are kept
in `/data/mindwtr-state.json`.

## Checked on a real server, and what was not

Checked against `ghcr.io/dongdongbh/mindwtr-cloud` 1.3.6 in a Docker network:
tasks in the four GTD lists, a reference note, a project, due dates with and
without a time, in the past, today and later, a daily repeating task completed,
a deleted task, created through the API. The real answers are in
`test/fixtures/mindwtr/` and drive the tests. The integration ran in its own
container under the Gladys sandbox limits (read-only root, no capabilities,
256 MB) against that server and the SDK's fake Gladys: counters, a task added
from a scene and its due date, a task completed, and `/v1/data` read
afterwards to check the apps would sync both.

Not checked: a real Gladys instance, the Mindwtr apps syncing the tasks added
by Gladys (only the server's document was read back), a server behind a
reverse proxy with a path prefix or an HTTPS certificate.

## Limitations

- Adds tasks to the inbox and marks tasks done; does not edit, delete or move
  them. Areas are not used; reference notes are not counted.
- A change made in an app shows up within the refresh interval, once the app
  has synced.
- Up to 20 pages of 500 open tasks are read.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory sync server (`test/helpers/fakeMindwtr.js`) built from real
answers. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Mindwtr](https://github.com/dongdongbh/Mindwtr) by dongdongbh and its
  contributors (AGPL-3.0): the integration only talks to the API of its sync
  server; no code was copied. The cover uses the Mindwtr app icon from its
  repository (`apps/desktop/public/icon.png`), to name the app.
- Requested by Philippe_B on the
  [Gladys forum](https://community.gladysassistant.com/t/10385/326).
- The architecture and the conformity tests follow
  [gladys-vikunja](https://github.com/guim31/gladys-vikunja),
  [gladys-donetick](https://github.com/guim31/gladys-donetick) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by the Mindwtr
project. The Mindwtr name and icon belong to their owners.

## License

Apache-2.0
