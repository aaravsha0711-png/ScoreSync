import shutil
from pathlib import Path
import matplotlib.pyplot as plt
import numpy as np

def export_to_sonus(data_dir: str, emotion: dict, jacket_path: str = None):
    level_name = "ai_generated_level"
    levels_dir = Path("../../levels") / level_name
    levels_dir.mkdir(parents=True, exist_ok=True)

    if jacket_path and Path(jacket_path).exists():
        shutil.copy(jacket_path, levels_dir / "jacket.png")
    else:
        generate_default_jacket(levels_dir / "jacket.png")

    # Placeholder for .sus / chart export
    print(f"Exported level with emotion: {emotion}")
    return "generated.mid", level_name

def generate_default_jacket(output_path):
    fig, ax = plt.subplots(figsize=(8, 8))
    ax.imshow(np.random.rand(512, 512, 3))
    ax.set_title("ScoreSync AI Generated", fontsize=16, color="white")
    ax.axis('off')
    plt.savefig(output_path, bbox_inches='tight', facecolor='black')
    plt.close()