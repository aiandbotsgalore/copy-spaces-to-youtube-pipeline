#!/usr/bin/env python3
"""
scripts/gen_clips_rss.py
Backward-compatible wrapper for SpacePipe Unified RSS Generator.
Delegates directly to generate_rss.py.
"""
from generate_rss import generate_clips_rss

def main():
    generate_clips_rss()

if __name__ == "__main__":
    main()
