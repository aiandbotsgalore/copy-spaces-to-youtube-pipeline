"""Accept current X Space ids and the current AudioSpaceById query.

yt-dlp 2026.10.26 matches exactly 13 characters after /i/spaces/. X lengthened
those ids to 14 characters in October 2026, so the builtin extractor queries
GraphQL with a truncated id. The payload then has no metadata field and the
download dies with KeyError('metadata'). See yt-dlp/yt-dlp#17955 and PR #17962.
"""

from __future__ import annotations

import inspect

from yt_dlp.extractor.twitter import TwitterSpacesIE
from yt_dlp.utils import ExtractorError, str_or_none, traverse_obj, url_or_none

_OLD_QUERY = 'HPEisOmj1epUNLCWTYhUWw/AudioSpaceById'
_NEW_QUERY = 'zm3JmUpYWDXIUsf_33-ZrA/AudioSpaceById'
_BUILTIN_URL = TwitterSpacesIE._VALID_URL
_BUILTIN_SOURCE = inspect.getsource(TwitterSpacesIE._real_extract)
_ID_TRUNCATED = (
    '[0-9a-zA-Z]{13}' in _BUILTIN_URL
    and '{13,}' not in _BUILTIN_URL
    and '[0-9a-zA-Z]+' not in _BUILTIN_URL
)
_QUERY_STALE = _OLD_QUERY in _BUILTIN_SOURCE


def _bigger_avatar(url):
    if not isinstance(url, str):
        return None
    return url.replace('_normal', '_400x400')


def creator_fields(metadata):
    """Read the host from either the legacy user object or the 2026 core/avatar shape."""
    if not isinstance(metadata, dict):
        return {}
    legacy = traverse_obj(metadata, ('creator_results', 'result', 'legacy', {
        'uploader': ('name', {str}),
        'uploader_id': ('screen_name', {str_or_none}),
        'thumbnail': ('profile_image_url_https', {_bigger_avatar}, {url_or_none}),
    })) or {}
    if legacy.get('uploader') or legacy.get('uploader_id'):
        return legacy
    return traverse_obj(metadata, ('creator_results', 'result', {
        'uploader': ('core', 'name', {str}),
        'uploader_id': ('core', 'screen_name', {str_or_none}),
        'thumbnail': ('avatar', 'image_url', {_bigger_avatar}, {url_or_none}),
    })) or {}


class TwitterSpacesCurrentIE(TwitterSpacesIE):
    IE_NAME = 'twitter:spaces:idfix'
    _ENABLED = _ID_TRUNCATED or _QUERY_STALE
    _VALID_URL = (
        _BUILTIN_URL.replace('[0-9a-zA-Z]{13}', '[0-9a-zA-Z]{13,}')
        if _ID_TRUNCATED else _BUILTIN_URL
    )

    def _load_audio_space(self, space_id):
        queries = (_NEW_QUERY, _OLD_QUERY) if _QUERY_STALE else (_NEW_QUERY,)
        fallback = None
        for operation in queries:
            try:
                payload = TwitterSpacesIE._call_graphql_api(self, operation, space_id)
            except ExtractorError:
                continue
            audio = payload.get('audioSpace') if isinstance(payload, dict) else None
            if not isinstance(audio, dict):
                continue
            if isinstance(audio.get('metadata'), dict):
                return audio
            fallback = audio
        return fallback

    def _real_extract(self, url):
        space_id = self._match_id(url)
        audio = self._load_audio_space(space_id)
        metadata = audio.get('metadata') if isinstance(audio, dict) else None
        if not isinstance(metadata, dict):
            raise ExtractorError(
                'Twitter Space not found or has no replay metadata',
                expected=True,
                video_id=space_id,
            )

        original = self._call_graphql_api

        def _call(operation, video_id, *args, **kwargs):
            if isinstance(operation, str) and operation.endswith('/AudioSpaceById'):
                return {'audioSpace': audio}
            return original(operation, video_id, *args, **kwargs)

        self._call_graphql_api = _call
        try:
            info = TwitterSpacesIE._real_extract(self, url)
        except KeyError as exc:
            if exc.args and exc.args[0] == 'metadata':
                raise ExtractorError(
                    'Twitter Space not found or has no replay metadata',
                    expected=True,
                    video_id=space_id,
                ) from exc
            raise
        finally:
            self._call_graphql_api = original

        for key, value in creator_fields(metadata).items():
            if value and not info.get(key):
                info[key] = value
        info['id'] = space_id
        return info
