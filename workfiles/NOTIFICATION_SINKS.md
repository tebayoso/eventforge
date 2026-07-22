# Notification sinks

Issue #23 currently establishes the fail-closed core delivery contract, exercised with fixtures only. Slack accepts only attested public/private channels where the bot is already a member. PagerDuty is constrained to its service-level Change Events endpoint, which provides context and links but does not create alerts, incidents, or notifications; capability or attestation failure suppresses delivery.

The contract uses a logical identity of event version, route version, template version, and destination. Rendered text is fixed, bounded, and neutralizes mentions, links, markup, and control-like characters. It includes no credentials, authorization, raw payload/evidence, prompts, model output, or action controls. Deep links remain ordinary EventForge URLs and require authentication and object/workspace authorization at open time.

No provider credentials, live provider sends, or production attestations were used in this fixture validation.
