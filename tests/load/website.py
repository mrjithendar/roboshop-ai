#!/usr/bin/env python3
"""Read-only live HTML smoke/load test. Uses curl with TLS verification enabled."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import shutil
import statistics
import subprocess
import threading
import time
import uuid
from urllib.parse import urlsplit

TARGET = 'https://jithendar.com/roboshop/'


def validate_target(url):
    parsed = urlsplit(url)
    # Deliberately keep live testing separate from authenticated/API scenarios.
    if (parsed.scheme != 'https' or parsed.netloc != 'jithendar.com'
            or parsed.path not in ('/roboshop', '/roboshop/')
            or parsed.query or parsed.fragment):
        raise ValueError('Only https://jithendar.com/roboshop/ HTML is allowed')
    return url


def request(url, timeout):
    started = time.monotonic()
    result = subprocess.run([
        'curl', '--disable', '--silent', '--show-error', '--max-time', str(timeout),
        '--noproxy', '*', '--output', '/dev/null', '--user-agent',
        'RoboShop-Authorized-Smoke/1.0', '--write-out', '%{http_code} %{time_total}', url,
    ], capture_output=True, text=True, timeout=timeout + 2)
    try:
        code, elapsed = result.stdout.split()
        return int(code), float(elapsed), result.returncode != 0
    except (ValueError, TypeError):
        return 0, time.monotonic() - started, True


def stage(url, users, seconds, interval, timeout, slow_seconds, stop, fetch=request):
    started = time.monotonic()
    deadline = started + seconds
    rows = []
    lock = threading.Lock()

    def visitor():
        while not stop.is_set() and time.monotonic() < deadline:
            tick = time.monotonic()
            try:
                code, elapsed, error = fetch(url, timeout)
            except (OSError, subprocess.TimeoutExpired):
                code, elapsed, error = 0, time.monotonic() - tick, True
            with lock:
                rows.append((code, elapsed, error))
            if error or code != 200 or elapsed > slow_seconds:
                stop.set()
            # No catch-up bursts after a slow request; each visitor has one in flight.
            stop.wait(min(max(0, interval - (time.monotonic() - tick)),
                          max(0, deadline - time.monotonic())))

    with ThreadPoolExecutor(max_workers=users) as pool:
        futures = [pool.submit(visitor) for _ in range(users)]
        try:
            for future in futures:
                future.result()
        except KeyboardInterrupt:
            stop.set()
            raise
    duration = time.monotonic() - started
    latencies = sorted(row[1] * 1000 for row in rows)
    return {
        'users': users, 'scheduledSeconds': seconds, 'elapsedSeconds': round(duration, 3),
        'intervalSecondsPerUser': interval, 'maximumOfferedRequestsPerSecond': users / interval,
        'requests': len(rows), 'achievedRequestsPerSecond': round(len(rows) / max(duration, .001), 3),
        'statuses': {str(code): sum(r[0] == code for r in rows) for code in sorted({r[0] for r in rows})},
        'transportErrors': sum(r[2] for r in rows),
        'medianMs': round(statistics.median(latencies), 1) if latencies else None,
        'p95Ms': round(latencies[math.ceil(.95 * len(latencies)) - 1], 1) if latencies else None,
        'maxMs': round(max(latencies), 1) if latencies else None,
        'stoppedEarly': stop.is_set(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=TARGET)
    parser.add_argument('--users', default='2', help='Concurrent visitors per stage, e.g. 2,5,10 (max 50)')
    parser.add_argument('--seconds', type=int, default=10, help='Duration per stage, 1–600 seconds')
    parser.add_argument('--interval', type=float, default=1, help='Seconds between requests per visitor, minimum 0.5')
    parser.add_argument('--stop-latency', type=float, default=3, help='Stop if any request exceeds this many seconds (max 10)')
    parser.add_argument('--confirm-live', action='store_true', help='Explicitly authorize traffic to the live website')
    args = parser.parse_args()
    try:
        validate_target(args.url)
        users = [int(v) for v in args.users.split(',')]
        if not 1 <= len(users) <= 10 or any(not 1 <= n <= 50 for n in users):
            raise ValueError('Specify 1–10 stages with 1–50 visitors each')
        if not 1 <= args.seconds <= 600 or not .5 <= args.interval <= 60 or not .1 <= args.stop_latency <= 10:
            raise ValueError('Use seconds 1–600, interval 0.5–60 and stop-latency 0.1–10')
    except ValueError as error:
        parser.error(str(error))
    if not args.confirm_live:
        parser.error('Add --confirm-live to authorize this live read-only test')
    if not shutil.which('curl'):
        parser.error('curl is required')
    run_id = 'website-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]
    folder = Path(__file__).resolve().parent / '.runs' / run_id
    folder.mkdir(parents=True, mode=0o700)
    report = {'runId': run_id, 'target': args.url, 'scope': 'HTML GET only; no assets, cookies, API, login, payment or AI', 'stages': []}
    stop = threading.Event()
    exit_code = 0
    try:
        for index, count in enumerate(users):
            print(f'Stage {index+1}/{len(users)}: {count} visitors for {args.seconds}s', flush=True)
            result = stage(args.url, count, args.seconds, args.interval, 10, args.stop_latency, stop)
            report['stages'].append(result)
            print(json.dumps(result, indent=2), flush=True)
            if stop.is_set():
                print('Stopped: non-200 response, transport error or latency safety threshold exceeded.')
                exit_code = 1
                break
            if index < len(users) - 1:
                print('Cooling down for 5 seconds.', flush=True)
                stop.wait(5)
    except KeyboardInterrupt:
        report['interrupted'] = True
        exit_code = 130
    finally:
        (folder / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
        print(f'Report: {folder / "summary.json"}')
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())
