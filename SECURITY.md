# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the **Mindwtr sync token**, stored by Gladys in the integration
  configuration (a `secret` field), sent only to the configured sync server in
  the `Authorization` header, and never logged. It is the same token as the
  apps' sync: whoever holds it can read and change the whole task list;
- under `/data`, only `mindwtr-state.json`: the configured address, a SHA-256
  hash prefix of the token (to tell two task lists apart, not the token), the
  time of the last reading, the ids of the open tasks and the time of the last
  inbox review (no task title);
- network: outgoing HTTP(S) requests to the configured sync server only. The
  integration never writes the sync document (`/v1/data`). With "Accept
  self-signed certificates" ticked, the certificate of that address is not
  verified.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Mindwtr itself.
