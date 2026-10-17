"""Legacy marker for the retired multi-profile credential spike.

The production flow is now web -> extension -> Native Messaging -> Go helper.
This file intentionally refuses to read local credential files or launch a
profile without a server-issued session context.
"""

import sys


def main() -> None:
    sys.exit(
        "Este spike fue retirado: no lee credenciales locales. "
        "Construye y registra local-helper/cmd/agency-os-helper para usar Native Messaging."
    )


if __name__ == "__main__":
    main()
