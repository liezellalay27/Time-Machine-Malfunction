from __future__ import annotations

import json
import os
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DB_PATH = Path(os.getenv("ALARM_DB_PATH", Path(__file__).with_name("alarms.db")))


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db


def initialize() -> None:
    with connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS alarms (
            id TEXT PRIMARY KEY,
            hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),
            minute INTEGER NOT NULL CHECK(minute BETWEEN 0 AND 59),
            label TEXT NOT NULL,
            days TEXT NOT NULL DEFAULT '[]',
            enabled INTEGER NOT NULL DEFAULT 1,
            notification_id TEXT
        )""")


class AlarmIn(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    hour: int = Field(ge=0, le=23)
    minute: int = Field(ge=0, le=59)
    label: str = Field(default="Alarm", max_length=80)
    days: list[int] = Field(default_factory=list)
    enabled: bool = True
    notificationId: str | None = None


def as_alarm(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "hour": row["hour"], "minute": row["minute"],
        "label": row["label"], "days": json.loads(row["days"]),
        "enabled": bool(row["enabled"]), "notificationId": row["notification_id"],
    }


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize()
    yield


app = FastAPI(title="Time Machine API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/alarms")
def list_alarms() -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute("SELECT * FROM alarms ORDER BY hour, minute").fetchall()
    return [as_alarm(row) for row in rows]


@app.post("/alarms")
def save_alarm(alarm: AlarmIn) -> dict[str, Any]:
    if any(day < 0 or day > 6 for day in alarm.days):
        raise HTTPException(status_code=422, detail="days must contain values from 0 (Sunday) to 6 (Saturday)")
    with connect() as db:
        db.execute(
            """INSERT INTO alarms (id, hour, minute, label, days, enabled, notification_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET hour=excluded.hour, minute=excluded.minute,
              label=excluded.label, days=excluded.days, enabled=excluded.enabled,
              notification_id=excluded.notification_id""",
            (alarm.id, alarm.hour, alarm.minute, alarm.label, json.dumps(sorted(set(alarm.days))),
             int(alarm.enabled), alarm.notificationId),
        )
        row = db.execute("SELECT * FROM alarms WHERE id = ?", (alarm.id,)).fetchone()
    return as_alarm(row)


@app.delete("/alarms/{alarm_id}", status_code=204)
def delete_alarm(alarm_id: str) -> None:
    with connect() as db:
        cursor = db.execute("DELETE FROM alarms WHERE id = ?", (alarm_id,))
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="Alarm not found")
