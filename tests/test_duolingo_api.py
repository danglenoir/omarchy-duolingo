from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "duolingo_api.py"
SPEC = importlib.util.spec_from_file_location("duolingo_api", MODULE_PATH)
assert SPEC and SPEC.loader
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)


def public_profile(end_date: str = "2026-08-20"):
    return {
        "id": 42,
        "name": "Ada Learner",
        "username": "ada",
        "streak": 37,
        "streakData": {
            "currentStreak": {
                "length": 37,
                "startDate": "2026-07-15",
                "endDate": end_date,
            }
        },
        "totalXp": 98765,
        "learningLanguage": "es",
        "currentCourseId": "DUOLINGO_ES_EN",
        "courses": [
            {
                "id": "DUOLINGO_FR_EN",
                "learningLanguage": "fr",
                "title": "French",
                "xp": 5000,
            },
            {
                "id": "DUOLINGO_ES_EN",
                "learningLanguage": "es",
                "title": "Spanish",
                "xp": 12345,
            },
        ],
    }


def private_profile():
    return {
        "gemsConfig": {"gems": 812},
        "health": {
            "hearts": 4,
            "maxHearts": 5,
            "unlimitedHeartsAvailable": False,
        },
    }


def active_leaderboard():
    return {
        "tier": 8,
        "active": {
            "user_id": 42,
            "score": 740,
            "cohort": {
                "tier": 9,
                "rankings": [
                    {"user_id": 7, "score": 900},
                    {"user_id": 42, "score": 740},
                    {"user_id": 8, "score": 600},
                ],
            },
        },
    }


class NormalizeTests(unittest.TestCase):
    def test_completed_today_uses_selected_course_and_private_stats(self):
        result = api.normalize_stats(
            public_profile(),
            private_profile(),
            active_leaderboard(),
            {"username": "ada", "language": "es"},
            today=dt.date(2026, 8, 20),
        )

        self.assertTrue(result["streak"]["todayDone"])
        self.assertFalse(result["streak"]["atRisk"])
        self.assertEqual(result["course"]["title"], "Spanish")
        self.assertEqual(result["courseXp"], 12345)
        self.assertEqual(result["totalXp"], 98765)
        self.assertEqual(result["currencies"]["gems"], 812)
        self.assertEqual(result["energy"]["label"], "Hearts")
        self.assertEqual(result["energy"]["current"], 4)
        self.assertEqual(result["energy"]["max"], 5)
        self.assertEqual(result["leaderboard"]["league"], "Diamond")
        self.assertEqual(result["leaderboard"]["position"], 2)
        self.assertEqual(result["leaderboard"]["score"], 740)
        self.assertTrue(result["privateStatsAvailable"])

    def test_yesterdays_end_date_marks_an_existing_streak_at_risk(self):
        result = api.normalize_stats(
            public_profile("2026-08-19"),
            None,
            {"tier": 4},
            {"username": "ada", "courseId": "DUOLINGO_FR_EN"},
            today=dt.date(2026, 8, 20),
        )

        self.assertFalse(result["streak"]["todayDone"])
        self.assertTrue(result["streak"]["atRisk"])
        self.assertEqual(result["course"]["title"], "French")
        self.assertEqual(result["leaderboard"]["league"], "Ruby")
        self.assertIsNone(result["currencies"]["gems"])
        self.assertFalse(result["privateStatsAvailable"])

    def test_zero_streak_is_not_presented_as_at_risk(self):
        profile = public_profile("")
        profile["streak"] = 0
        profile["streakData"] = {"currentStreak": None}
        result = api.normalize_stats(
            profile,
            None,
            None,
            {"username": "ada"},
            today=dt.date(2026, 8, 20),
        )

        self.assertEqual(result["streak"]["days"], 0)
        self.assertFalse(result["streak"]["todayDone"])
        self.assertFalse(result["streak"]["atRisk"])

    def test_energy_schema_takes_precedence_over_hearts(self):
        profile = public_profile()
        private = {
            "energyConfig": {"currentEnergy": 18, "maxEnergy": 25},
            "health": {"hearts": 2, "maxHearts": 5},
        }
        result = api.normalize_stats(
            profile,
            private,
            None,
            {"username": "ada"},
            today=dt.date(2026, 8, 20),
        )

        self.assertEqual(result["energy"], {"label": "Energy", "current": 18, "max": 25, "unlimited": False})


class FakeClient:
    def __init__(self, private_error=None):
        self.private_error = private_error
        self.calls = []

    def get_json(self, url, jwt=""):
        self.calls.append((url, jwt))
        if "users?" in url:
            return {"users": [public_profile()]}
        if "duolingo-leaderboards" in url:
            return active_leaderboard()
        if self.private_error:
            raise self.private_error
        return private_profile()


class LegacyClient(FakeClient):
    def get_json(self, url, jwt=""):
        self.calls.append((url, jwt))
        if "users?" in url:
            return {"users": [public_profile()]}
        if "duolingo-leaderboards" in url:
            return active_leaderboard()
        if url.endswith("/users/ada"):
            return {"lingots": 27, "health": {"hearts": 3, "maxHearts": 5}}
        return {"gemsConfig": {"gems": 812}}


class FetchTests(unittest.TestCase):
    def test_auth_failure_keeps_public_profile_usable(self):
        client = FakeClient(api.WidgetError("authentication_failed", "bad token"))
        result = api.fetch_stats({"username": "ada", "jwt": "secret"}, client=client)

        self.assertTrue(result["ok"])
        self.assertFalse(result["privateStatsAvailable"])
        self.assertEqual(result["warnings"][0]["code"], "authentication_failed")
        self.assertEqual(result["leaderboard"]["position"], 2)

    def test_public_mode_does_not_send_a_token(self):
        client = FakeClient()
        result = api.fetch_stats({"username": "ada"}, client=client)

        self.assertTrue(result["ok"])
        self.assertEqual(result["warnings"][0]["code"], "public_profile_only")
        self.assertTrue(all(jwt == "" for _, jwt in client.calls))

    def test_authenticated_legacy_values_are_merged_with_modern_values(self):
        client = LegacyClient()
        result = api.fetch_stats({"username": "ada", "jwt": "secret"}, client=client)

        self.assertTrue(result["privateStatsAvailable"])
        self.assertEqual(result["currencies"], {"gems": 812, "lingots": 27})
        self.assertEqual(result["energy"]["current"], 3)
        leaderboard_calls = [call for call in client.calls if "duolingo-leaderboards" in call[0]]
        self.assertEqual(len(leaderboard_calls), 1)
        self.assertEqual(leaderboard_calls[0][1], "")


class CacheTests(unittest.TestCase):
    def test_missing_config_is_machine_readable(self):
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(
                config=str(Path(directory) / "missing.json"),
                cache=str(Path(directory) / "cache.json"),
                max_age=60,
                timeout=1.0,
                force=False,
            )
            result = api.run(args)

        self.assertFalse(result["ok"])
        self.assertFalse(result["configured"])
        self.assertEqual(result["errorCode"], "not_configured")

    def test_cache_is_scoped_to_username_and_course(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stats.json"
            data = {"ok": True, "profile": {"username": "ada"}}
            api.save_cache(path, "ada||es", data)

            self.assertEqual(api.load_cache(path, "ada||es", max_age=60), data)
            self.assertIsNone(api.load_cache(path, "grace||es", max_age=60))


if __name__ == "__main__":
    unittest.main()
