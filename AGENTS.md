# SafeMeLink development rules

For every app change, check compatibility across the full Android and iOS version ranges that the project supports. Apply this to features, fixes, permissions, native modules, notifications, background behavior, UI and backend contracts. Do not tailor a fix only to the device that exposed the issue.

Before editing, identify the actual minimum and target platform versions in the current project and the OS-specific behavior affected by the change. Cover older supported APIs, version transition points and current APIs. Preserve safe behavior when a device lacks required hardware, SIM, permission or system support; report a specific limitation or use an explicit fallback. Never report an SOS, SMS, location update or notification as sent or delivered without the corresponding evidence.

Run relevant checks available in the environment, including platform compilation and tests where feasible. For device-dependent behavior, specify a practical test matrix spanning supported OS versions and different manufacturers. Clearly distinguish checks that passed, failed and could not be run. Source review or emulator tests do not prove that every phone works; report remaining physical-device checks before declaring a feature ready.

Include this compatibility assessment in the handoff to Codex and in the final report for each phase. Keep the user's established workflow: Codex handles the reviewed source commit and publication when authorized, and the user starts APK builds manually. Do not launch builds or deploy without authorization.
