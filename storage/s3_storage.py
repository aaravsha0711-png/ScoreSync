import boto3
import os
from pathlib import Path

class S3Storage:
    def __init__(self):
        self.bucket = os.getenv("S3_BUCKET_NAME")
        if not self.bucket:
            print("⚠️ S3 not configured - using local storage")
            self.enabled = False
            return
        
        self.s3 = boto3.client('s3')
        self.enabled = True

    def upload(self, local_path: str, s3_key: str):
        if not self.enabled:
            return False
        try:
            self.s3.upload_file(local_path, self.bucket, s3_key)
            print(f"✅ Uploaded to S3: {s3_key}")
            return True
        except Exception as e:
            print(f"S3 upload error: {e}")
            return False

    def download(self, s3_key: str, local_path: str):
        if not self.enabled:
            return False
        try:
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
            self.s3.download_file(self.bucket, s3_key, local_path)
            print(f"✅ Downloaded from S3: {s3_key}")
            return True
        except Exception:
            return False