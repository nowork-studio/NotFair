"""Helpers for invoking the gcloud CLI portably."""

import shutil
import subprocess
import sys


def gcloud_command(args):
    """Return a subprocess argument list for a gcloud command.

    On Windows, the Google Cloud SDK installs gcloud as gcloud.cmd. Python's
    shell=False path resolution does not expand PATHEXT for CreateProcess, so
    invoke the resolved batch file through cmd.exe.
    """
    if not args or args[0] != "gcloud":
        raise ValueError("gcloud_command expects args starting with 'gcloud'")

    gcloud = shutil.which("gcloud")
    if sys.platform == "win32" and gcloud and gcloud.lower().endswith((".cmd", ".bat")):
        return ["cmd", "/c", gcloud, *args[1:]]

    return [gcloud or "gcloud", *args[1:]]


def gcloud_run(args, *run_args, **run_kwargs):
    """Run gcloud with subprocess.run using the portable command wrapper."""
    return subprocess.run(gcloud_command(args), *run_args, **run_kwargs)


# Search Console needs an explicitly-requested scope. Service-account ADC
# (GOOGLE_APPLICATION_CREDENTIALS) mints a cloud-platform-only token by default,
# which searchconsole.googleapis.com rejects with 403
# ACCESS_TOKEN_SCOPE_INSUFFICIENT.
GSC_SCOPES = (
    "https://www.googleapis.com/auth/webmasters.readonly,"
    "https://www.googleapis.com/auth/cloud-platform"
)


def adc_access_token(scopes=GSC_SCOPES, timeout=15):
    """Mint an Application Default Credentials access token.

    Requests `scopes` explicitly so that service-account credentials can reach
    Search Console. User credentials that were not granted those scopes at
    login cannot mint them, so fall back to an unscoped request rather than
    failing outright.
    """
    attempts = []
    if scopes:
        attempts.append(
            ["gcloud", "auth", "application-default", "print-access-token",
             f"--scopes={scopes}"]
        )
    attempts.append(["gcloud", "auth", "application-default", "print-access-token"])

    result = None
    for args in attempts:
        result = gcloud_run(args, capture_output=True, text=True, timeout=timeout)
        if result.returncode == 0 and result.stdout.strip():
            return result
    return result
