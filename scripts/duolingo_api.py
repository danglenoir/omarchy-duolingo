#!/usr/bin/env python3
"""Fetch and normalize Duolingo profile data for the Omarchy widget."""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time
from typing import Any
from urllib import error, parse, request


PUBLIC_USER_URL = "https://www.duolingo.com/2017-06-30/users"
PRIVATE_USER_URL = "https://www.duolingo.com/2017-06-30/users/{user_id}"
LEGACY_USER_URL = "https://www.duolingo.com/users/{username}"
LEADERBOARD_URL = (
    "https://duolingo-leaderboards-prod.duolingo.com/leaderboards/"
    "7d9f5dd1-8423-491a-91f2-2532052038ce/users/{user_id}"
)
PRIVATE_FIELDS = [
    "courses",
    "currentCourse",
    "fromLanguage",
    "gemsConfig",
    "health",
    "id",
    "learningLanguage",
    "name",
    "streak",
    "streakData{currentStreak}",
    "totalXp",
    "username",
]
LEAGUES = [
    "Bronze",
    "Silver",
    "Gold",
    "Sapphire",
    "Ruby",
    "Emerald",
    "Amethyst",
    "Pearl",
    "Obsidian",
    "Diamond",
]
USER_AGENT = "Omarchy-Duolingo/1.0"


class WidgetError(Exception):
    """A user-facing configuration or API error."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ApiClient:
    def __init__(self, timeout: float = 12.0):
        self.timeout = timeout

    def get_json(self, url: str, jwt: str = "") -> dict[str, Any]:
        headers = {
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        token = normalize_token(jwt)
        if token:
            headers["Authorization"] = f"Bearer {token}"
            headers["Cookie"] = f"jwt_token={token}"

        req = request.Request(url, headers=headers)
        try:
            with request.urlopen(req, timeout=self.timeout) as response:
                payload = response.read().decode("utf-8")
        except error.HTTPError as exc:
            if exc.code in (401, 403):
                raise WidgetError("authentication_failed", "Duolingo rejected the session token.") from exc
            if exc.code == 404:
                raise WidgetError("not_found", "Duolingo could not find that resource.") from exc
            if exc.code == 429:
                raise WidgetError("rate_limited", "Duolingo is rate-limiting requests. Try again later.") from exc
            raise WidgetError("api_error", f"Duolingo returned HTTP {exc.code}.") from exc
        except (error.URLError, TimeoutError, OSError) as exc:
            raise WidgetError("network_error", "Could not reach Duolingo.") from exc

        try:
            data = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise WidgetError("invalid_response", "Duolingo returned an unreadable response.") from exc
        if not isinstance(data, dict):
            raise WidgetError("invalid_response", "Duolingo returned an unexpected response.")
        return data


def normalize_token(value: Any) -> str:
    token = str(value or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


def as_int(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError, OverflowError):
        return None


def nested(data: Any, *keys: str) -> Any:
    current = data
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def first_int(*values: Any) -> int | None:
    for value in values:
        parsed = as_int(value)
        if parsed is not None:
            return parsed
    return None


def first_text(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def parse_iso_date(value: Any) -> dt.date | None:
    text = str(value or "").strip()[:10]
    if not text:
        return None
    try:
        return dt.date.fromisoformat(text)
    except ValueError:
        return None


def merge_profiles(public: dict[str, Any], private: dict[str, Any] | None) -> dict[str, Any]:
    merged = dict(public)
    if private:
        for key, value in private.items():
            if value is not None:
                merged[key] = value
    return merged


def choose_course(profile: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    courses = [course for course in profile.get("courses", []) if isinstance(course, dict)]
    current = profile.get("currentCourse")
    if isinstance(current, dict) and not any(course.get("id") == current.get("id") for course in courses):
        courses.insert(0, current)

    course_id = first_text(config.get("courseId"), config.get("course_id"))
    language = first_text(config.get("language"), config.get("course")).lower()
    current_id = first_text(profile.get("currentCourseId"), nested(current, "id"))
    learning_language = first_text(profile.get("learningLanguage"), nested(current, "learningLanguage")).lower()

    selected: dict[str, Any] | None = None
    if course_id:
        selected = next((course for course in courses if str(course.get("id", "")) == course_id), None)
    if selected is None and language:
        selected = next(
            (course for course in courses if str(course.get("learningLanguage", "")).lower() == language),
            None,
        )
    if selected is None and current_id:
        selected = next((course for course in courses if str(course.get("id", "")) == current_id), None)
    if selected is None and learning_language:
        selected = next(
            (course for course in courses if str(course.get("learningLanguage", "")).lower() == learning_language),
            None,
        )
    if selected is None and courses:
        selected = max(courses, key=lambda course: as_int(course.get("xp")) or 0)

    selected = selected or {}
    code = first_text(selected.get("learningLanguage"), language, learning_language)
    title = first_text(selected.get("title"), code.upper() if code else "Current course")
    return {
        "id": first_text(selected.get("id"), course_id),
        "language": code,
        "title": title,
        "xp": as_int(selected.get("xp")),
    }


def normalize_streak(profile: dict[str, Any], today: dt.date) -> dict[str, Any]:
    current = nested(profile, "streakData", "currentStreak")
    current = current if isinstance(current, dict) else {}
    days = first_int(current.get("length"), profile.get("streak"), 0) or 0
    end_date = parse_iso_date(current.get("endDate"))
    today_done = end_date is not None and end_date >= today
    return {
        "days": max(0, days),
        "lastDate": end_date.isoformat() if end_date else "",
        "todayDone": today_done,
        "atRisk": days > 0 and not today_done,
    }


def normalize_energy(profile: dict[str, Any]) -> dict[str, Any]:
    energy = profile.get("energyConfig")
    if not isinstance(energy, dict):
        energy = profile.get("energy")
    if isinstance(energy, dict):
        current = first_int(
            energy.get("currentEnergy"), energy.get("energy"), energy.get("current"), energy.get("value")
        )
        maximum = first_int(
            energy.get("maxEnergy"), energy.get("maximum"), energy.get("max"), energy.get("capacity")
        )
        if current is not None or maximum is not None:
            return {"label": "Energy", "current": current, "max": maximum, "unlimited": False}
    elif energy is not None:
        current = as_int(energy)
        if current is not None:
            return {"label": "Energy", "current": current, "max": None, "unlimited": False}

    health = profile.get("health")
    if isinstance(health, dict):
        unlimited = bool(
            health.get("unlimitedHeartsAvailable")
            or health.get("unlimitedHearts")
            or health.get("unlimited")
        )
        current = first_int(health.get("hearts"), health.get("health"), health.get("current"))
        maximum = first_int(health.get("maxHearts"), health.get("maxHealth"), health.get("max"))
        return {"label": "Hearts", "current": current, "max": maximum, "unlimited": unlimited}
    current = as_int(health)
    return {"label": "Energy", "current": current, "max": None, "unlimited": False}


def normalize_leaderboard(raw: dict[str, Any] | None, user_id: int | None) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    board = raw.get("leaderboard") if isinstance(raw.get("leaderboard"), dict) else raw
    active = board.get("active") if isinstance(board.get("active"), dict) else None
    cohort = active.get("cohort") if active and isinstance(active.get("cohort"), dict) else {}
    tier = first_int(cohort.get("tier"), active.get("tier") if active else None, board.get("tier"), raw.get("tier"))
    league = LEAGUES[tier] if tier is not None and 0 <= tier < len(LEAGUES) else "Unranked"

    rankings = cohort.get("rankings") if isinstance(cohort.get("rankings"), list) else []
    standing: dict[str, Any] | None = None
    position: int | None = None
    for index, row in enumerate(rankings):
        if not isinstance(row, dict):
            continue
        row_user_id = first_int(row.get("user_id"), row.get("userId"))
        if user_id is not None and row_user_id == user_id:
            standing = row
            position = index + 1
            break

    if standing is None and active:
        active_user_id = first_int(active.get("user_id"), active.get("userId"))
        if user_id is not None and active_user_id == user_id:
            standing = active
            raw_rank = first_int(active.get("rank"))
            if raw_rank is not None:
                position = raw_rank + 1

    score = first_int(
        standing.get("score") if standing else None,
        active.get("score") if active else None,
    )
    return {
        "league": league,
        "tier": tier,
        "position": position,
        "score": score,
        "active": active is not None,
    }


def normalize_stats(
    public_profile: dict[str, Any],
    private_profile: dict[str, Any] | None,
    leaderboard: dict[str, Any] | None,
    config: dict[str, Any],
    today: dt.date | None = None,
    warnings: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    profile = merge_profiles(public_profile, private_profile)
    user_id = as_int(profile.get("id"))
    today = today or dt.date.today()
    course = choose_course(profile, config)
    gems = first_int(
        nested(profile, "gemsConfig", "gems"),
        profile.get("gems"),
        nested(profile, "currency", "gems"),
        profile.get("rupees"),
    )
    lingots = first_int(profile.get("lingots"), nested(profile, "currency", "lingots"))

    return {
        "ok": True,
        "configured": True,
        "stale": False,
        "error": "",
        "errorCode": "",
        "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "profile": {
            "id": user_id,
            "name": first_text(profile.get("name"), profile.get("username"), config.get("username")),
            "username": first_text(profile.get("username"), config.get("username")),
        },
        "course": course,
        "streak": normalize_streak(profile, today),
        "courseXp": course.get("xp"),
        "totalXp": as_int(profile.get("totalXp")),
        "currencies": {
            "gems": gems,
            "lingots": lingots,
        },
        "energy": normalize_energy(profile),
        "leaderboard": normalize_leaderboard(leaderboard, user_id),
        "privateStatsAvailable": private_profile is not None,
        "warnings": list(warnings or []),
    }


def default_config_path() -> Path:
    config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return config_home / "omarchy" / "duolingo.json"


def default_cache_path() -> Path:
    cache_home = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return cache_home / "omarchy-duolingo" / "stats.json"


def load_config(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise WidgetError("not_configured", f"Create {path} to configure Duolingo.") from exc
    except OSError as exc:
        raise WidgetError("config_unreadable", f"Could not read {path}.") from exc
    try:
        config = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise WidgetError("invalid_config", f"{path} is not valid JSON.") from exc
    if not isinstance(config, dict):
        raise WidgetError("invalid_config", f"{path} must contain a JSON object.")
    if not first_text(config.get("username")):
        raise WidgetError("invalid_config", f"Add your Duolingo username to {path}.")
    return config


def config_identity(config: dict[str, Any]) -> str:
    return "|".join(
        [
            first_text(config.get("username")).lower(),
            first_text(config.get("courseId"), config.get("course_id")).lower(),
            first_text(config.get("language"), config.get("course")).lower(),
        ]
    )


def load_cache(path: Path, identity: str, max_age: int | None = None) -> dict[str, Any] | None:
    try:
        wrapper = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(wrapper, dict) or wrapper.get("identity") != identity:
            return None
        saved_at = float(wrapper.get("savedAt", 0))
        if max_age is not None and time.time() - saved_at > max_age:
            return None
        data = wrapper.get("data")
        return data if isinstance(data, dict) and data.get("ok") is True else None
    except (FileNotFoundError, OSError, ValueError, TypeError, json.JSONDecodeError):
        return None


def save_cache(path: Path, identity: str, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    wrapper = {"identity": identity, "savedAt": time.time(), "data": data}
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, prefix=".stats-", delete=False
        ) as handle:
            temporary = Path(handle.name)
            os.chmod(temporary, 0o600)
            json.dump(wrapper, handle, separators=(",", ":"), ensure_ascii=True)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink(missing_ok=True)


def fetch_stats(config: dict[str, Any], client: ApiClient | None = None) -> dict[str, Any]:
    client = client or ApiClient()
    username = first_text(config.get("username"))
    jwt = normalize_token(config.get("jwt") or config.get("jwtToken") or config.get("token"))
    warnings: list[dict[str, str]] = []

    public_url = PUBLIC_USER_URL + "?" + parse.urlencode({"username": username})
    public_response = client.get_json(public_url)
    users = public_response.get("users")
    if not isinstance(users, list) or not users or not isinstance(users[0], dict):
        raise WidgetError("profile_not_found", f'Duolingo profile "{username}" was not found or is private.')
    public_profile = users[0]
    user_id = as_int(public_profile.get("id"))
    if user_id is None:
        raise WidgetError("invalid_response", "Duolingo did not return a user ID.")

    private_profile: dict[str, Any] | None = None
    if jwt:
        private_parts: list[dict[str, Any]] = []
        private_errors: list[WidgetError] = []
        fields = ",".join(PRIVATE_FIELDS)
        private_url = PRIVATE_USER_URL.format(user_id=user_id) + "?" + parse.urlencode({"fields": fields})
        try:
            private_parts.append(client.get_json(private_url, jwt=jwt))
        except WidgetError as exc:
            private_errors.append(exc)

        # Older accounts can still expose Lingots and legacy health values only
        # through the authenticated username endpoint. It is optional and the
        # modern response always wins when both contain the same field.
        legacy_url = LEGACY_USER_URL.format(username=parse.quote(username, safe=""))
        try:
            private_parts.insert(0, client.get_json(legacy_url, jwt=jwt))
        except WidgetError as exc:
            private_errors.append(exc)

        if private_parts:
            private_profile = {}
            for part in private_parts:
                private_profile = merge_profiles(private_profile, part)
        elif private_errors:
            warnings.append({"code": private_errors[0].code, "message": private_errors[0].message})
    else:
        warnings.append(
            {
                "code": "public_profile_only",
                "message": "Add your session token to show gems and energy.",
            }
        )

    leaderboard: dict[str, Any] | None = None
    leaderboard_url = LEADERBOARD_URL.format(user_id=user_id) + "?" + parse.urlencode(
        {"client_unlocked": "true", "get_reactions": "true"}
    )
    try:
        leaderboard = client.get_json(leaderboard_url)
    except WidgetError as exc:
        warnings.append({"code": "leaderboard_unavailable", "message": exc.message})

    return normalize_stats(public_profile, private_profile, leaderboard, config, warnings=warnings)


def error_payload(exc: WidgetError, configured: bool = False) -> dict[str, Any]:
    return {
        "ok": False,
        "configured": configured,
        "stale": False,
        "error": exc.message,
        "errorCode": exc.code,
        "fetchedAt": "",
    }


def run(args: argparse.Namespace) -> dict[str, Any]:
    config_path = Path(args.config).expanduser()
    try:
        config = load_config(config_path)
    except WidgetError as exc:
        return error_payload(exc, configured=False)

    identity = config_identity(config)
    cache_path = Path(args.cache).expanduser()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = cache_path.with_suffix(cache_path.suffix + ".lock")
    with lock_path.open("a", encoding="utf-8") as lock:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)

        if not args.force:
            cached = load_cache(cache_path, identity, max_age=max(0, args.max_age))
            if cached is not None:
                return cached

        try:
            data = fetch_stats(config, ApiClient(timeout=args.timeout))
            jwt = normalize_token(config.get("jwt") or config.get("jwtToken") or config.get("token"))
            try:
                mode = stat.S_IMODE(config_path.stat().st_mode)
            except OSError:
                mode = 0
            if jwt and mode & 0o077:
                data["warnings"].append(
                    {
                        "code": "insecure_config_permissions",
                        "message": f"Protect {config_path} with chmod 600.",
                    }
                )
            save_cache(cache_path, identity, data)
            return data
        except WidgetError as exc:
            stale = load_cache(cache_path, identity)
            if stale is not None:
                stale = dict(stale)
                stale["stale"] = True
                stale["error"] = exc.message
                stale["errorCode"] = exc.code
                return stale
            return error_payload(exc, configured=True)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(default_config_path()))
    parser.add_argument("--cache", default=str(default_cache_path()))
    parser.add_argument("--max-age", type=int, default=60)
    parser.add_argument("--timeout", type=float, default=12.0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--pretty", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    data = run(args)
    json.dump(data, sys.stdout, indent=2 if args.pretty else None, separators=None if args.pretty else (",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
