# Security policy

## Reporting a vulnerability

Report it privately. Open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public
issue, discussion or pull request about it.

Please include:

- what an attacker can do, and what they need first (an account, a role, a shared file, network position);
- the steps to reproduce, or a proof of concept;
- the release you tested (the image tag or chart version) and how it was installed (Compose or Helm).

Our response targets:

- acknowledge the report within 3 business days;
- tell you within 10 business days whether we confirm it, and how severe we think it is;
- keep you updated until it is fixed, and agree a disclosure date with you, normally no later than 90 days after the
  report;
- publish a GitHub Security Advisory with the fixed release, with a CVE where one is warranted, and credit you unless
  you ask us not to.

Please give us a reasonable chance to release a fix before you disclose. We won't pursue or support legal action against
research done in good faith under this policy: testing only installs you own or are allowed to test, not accessing or
keeping other people's data beyond what proves the issue, and not degrading service for others.

## Supported versions

Fixes go into the latest release only: the newest `vX.Y.Z` on the releases page, which the image tags and the chart
version follow. Upgrade to it to get them (see [Upgrade](docs/self-host/operations.md#upgrade)).

## Scope

In scope: the code in this repository, the published images and Helm chart, and an install set up as
[the self-hosting guide](docs/self-host.md) describes.

Out of scope:

- a finding that exists only because an install skips the
  [hardening checklist](docs/self-host/security.md#hardening-checklist) or changes a documented default (an escape from
  the container or the install's network boundary stays in scope);
- denial of service by request volume;
- social engineering and physical attacks;
- anything that needs an Admin account and harms only that install;
- findings from automated scanners without a demonstrated impact.

## Built-in protections

[Security](docs/self-host/security.md) describes what the install protects by default, what leaves it, and what an
operator can see.
