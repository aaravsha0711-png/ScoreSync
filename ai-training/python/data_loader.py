from pathlib import Path
def load_user_data(data_dir):
    path = Path(data_dir)
    path.mkdir(parents=True, exist_ok=True)
    return list(path.glob("**/*.*"))