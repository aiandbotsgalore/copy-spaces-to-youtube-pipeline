#!/usr/bin/env python3
"""
scripts/gen_podcast_rss.py
Backward-compatible wrapper for SpacePipe Unified RSS Generator.
Delegates directly to generate_rss.py.
"""
from generate_rss import generate_podcast_rss

def main():
    generate_podcast_rss()

if __name__ == "__main__":
    main()
