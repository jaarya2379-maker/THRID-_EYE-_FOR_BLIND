"""
Local Web Server for Third Eye AI Dashboard
Serves the web application and launches it automatically in your default browser.
"""

import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def main():
    os.chdir(DIRECTORY)
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}"
        print("=" * 65)
        print("     THIRD EYE AI — TELE-CARE & VISION DASHBOARD")
        print("=" * 65)
        print(f"🚀 Dashboard running at: {url}")
        print("⚡ Open this link in Google Chrome, Edge, or Opera for Web Serial support.")
        print("=" * 65)
        
        # Open in default browser
        webbrowser.open(url)
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down dashboard...")
            httpd.shutdown()

if __name__ == "__main__":
    main()
