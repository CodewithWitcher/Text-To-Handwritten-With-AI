#!/usr/bin/env python3
"""Run the app from a clone of the repo: python3 server.py [--port 8080] [--no-open]

The server itself lives in text_to_handwriting_ai/server.py (also used by the
pip package). See that file for details.
"""

from text_to_handwriting_ai.server import main

if __name__ == "__main__":
    main()
