"""Seeds our own Canvas LMS instance so it looks like a school: a test student, courses, assignments.

Dev only. It uses CANVAS_LMS_ADMIN_TOKEN, an access token the instance's admin made for themselves
(Account > Settings > New Access Token). The app never reads that token; students connect through
OAuth2 (canvas_lms.py). Safe to re-run: it finds what already exists by name.

    uv run python scripts/canvas_lms_seed.py --student-email maria@example.com --student-password '...'
    uv run python scripts/canvas_lms_seed.py ... --school "Learning Grounds Academy"   # renames the root account
"""
import argparse
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

COURSES = {
    "Algebra I": [("Quiz: linear equations", 2), ("Worksheet: slope and intercept", 5)],
    "Biology 101": [("Lab report: cell structure", 3), ("Reading: photosynthesis notes", 6)],
    "World History": [("Essay outline: the Industrial Revolution", 4)],
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--student-name", default="Maria Silva")
    parser.add_argument("--student-email", required=True, help="The test student's Canvas LMS login")
    parser.add_argument("--student-password", required=True)
    parser.add_argument("--student-locale", default="pt-BR", help="Shows off the language import")
    parser.add_argument("--school", help="Rename the root account (the school name the import shows)")
    args = parser.parse_args()

    base = os.environ.get("CANVAS_LMS_BASE_URL", "").rstrip("/")
    token = os.environ.get("CANVAS_LMS_ADMIN_TOKEN", "")
    if not base or not token:
        sys.exit("Set CANVAS_LMS_BASE_URL and CANVAS_LMS_ADMIN_TOKEN in api/.env first.")
    tz = ZoneInfo(os.environ.get("CANVAS_LMS_TIMEZONE", "America/New_York"))

    with httpx.Client(
        base_url=base,
        headers={"Authorization": f"Bearer {token}", "User-Agent": "LearningGrounds-seed/0.1"},
        timeout=20,
    ) as client:

        def call(method: str, path: str, **kwargs) -> dict | list:
            response = client.request(method, path, **kwargs)
            if response.status_code >= 400:
                sys.exit(f"{method} {path} failed: {response.status_code} {response.text[:300]}")
            return response.json()

        account = call("GET", "/api/v1/accounts")[0]
        account_id = account["id"]
        print(f"Account: {account['name']} ({account_id})")
        if args.school:
            call("PUT", f"/api/v1/accounts/{account_id}", data={"account[name]": args.school})
            print(f"  renamed to {args.school}")

        users = call("GET", f"/api/v1/accounts/{account_id}/users", params={"search_term": args.student_email})
        if users:
            student = users[0]
            print(f"Student exists: {student['name']} ({student['id']})")
        else:
            student = call(
                "POST",
                f"/api/v1/accounts/{account_id}/users",
                data={
                    "user[name]": args.student_name,
                    "user[locale]": args.student_locale,
                    "user[terms_of_use]": "true",
                    "user[skip_registration]": "true",
                    "pseudonym[unique_id]": args.student_email,
                    "pseudonym[password]": args.student_password,
                    "pseudonym[send_confirmation]": "false",
                    "communication_channel[skip_confirmation]": "true",
                },
            )
            print(f"Student created: {student['name']} ({student['id']})")

        today = datetime.now(tz).replace(hour=23, minute=59, second=0, microsecond=0)
        for course_name, assignments in COURSES.items():
            found = call("GET", f"/api/v1/accounts/{account_id}/courses", params={"search_term": course_name})
            course = next((c for c in found if c["name"] == course_name), None)
            if not course:
                code = "".join(word[0] for word in course_name.split()).upper() + "-101"
                course = call(
                    "POST",
                    f"/api/v1/accounts/{account_id}/courses",
                    data={"course[name]": course_name, "course[course_code]": code, "offer": "true"},
                )
                print(f"Course created: {course_name} ({course['id']})")
            else:
                call("PUT", f"/api/v1/courses/{course['id']}", data={"offer": "true"})
                print(f"Course exists: {course_name} ({course['id']})")

            enrollments = call(
                "GET", f"/api/v1/courses/{course['id']}/enrollments", params={"user_id": student["id"]}
            )
            if not enrollments:
                call(
                    "POST",
                    f"/api/v1/courses/{course['id']}/enrollments",
                    data={
                        "enrollment[user_id]": student["id"],
                        "enrollment[type]": "StudentEnrollment",
                        "enrollment[enrollment_state]": "active",
                        "enrollment[notify]": "false",
                    },
                )
                print("  enrolled the student")

            existing = {a["name"] for a in call("GET", f"/api/v1/courses/{course['id']}/assignments", params={"per_page": 100})}
            for name, days in assignments:
                if name in existing:
                    continue
                call(
                    "POST",
                    f"/api/v1/courses/{course['id']}/assignments",
                    data={
                        "assignment[name]": name,
                        "assignment[due_at]": (today + timedelta(days=days)).isoformat(),
                        "assignment[points_possible]": "10",
                        "assignment[submission_types][]": "online_text_entry",
                        "assignment[published]": "true",
                    },
                )
                print(f"  assignment: {name} (due in {days} days)")

    print("\nDone. Connect Canvas LMS in the app and log in on Canvas LMS as", args.student_email)


if __name__ == "__main__":
    main()
