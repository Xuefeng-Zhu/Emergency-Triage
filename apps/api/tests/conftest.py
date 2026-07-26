import os

# Settings reads a repo-root .env, so on a box configured for live mode the
# suite would otherwise drive the real sandbox and GPU. Real env vars take
# precedence over the dotenv file, so pinning them here keeps the tests
# hermetic. Set TRIAGE_TEST_ALLOW_ENV=1 to opt out.
if os.environ.get("TRIAGE_TEST_ALLOW_ENV") != "1":
    os.environ["TRIAGE_MODE"] = "stub"
    os.environ["TRIAGE_STT_MODE"] = "stub"
