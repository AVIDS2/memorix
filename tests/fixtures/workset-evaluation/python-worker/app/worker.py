MAX_RETRIES = 3


def dispatch_job(job_id: str, attempts: int) -> bool:
    return attempts < MAX_RETRIES and bool(job_id)
