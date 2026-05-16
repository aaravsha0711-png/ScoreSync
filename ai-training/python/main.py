import sys
from pathlib import Path

from data_loader import load_user_data
from guitar_processor import process_guitar_input
from emotion_classifier import EmotionClassifier
from trainer import LoRATrainer
from chart_exporter import export_to_sonus

def main():
    if len(sys.argv) < 2:
        print("Usage: python main.py <command> [data_dir] [jacket_path]")
        print("Commands: ingest, guitar, train, generate")
        return

    cmd = sys.argv[1]
    data_dir = sys.argv[2] if len(sys.argv) > 2 else "user_data"

    if cmd == "ingest":
        data = load_user_data(data_dir)
        print(f"Ingested {len(data)} items")

    elif cmd == "guitar":
        midi_path = process_guitar_input(data_dir)
        print(f"Guitar processed → {midi_path}")

    elif cmd == "train":
        trainer = LoRATrainer()
        trainer.fine_tune(data_dir, epochs=5)
        print("Fine-tuning completed")

    elif cmd == "generate":
        emotion = EmotionClassifier().predict(data_dir)
        jacket = sys.argv[3] if len(sys.argv) > 3 else None
        midi, level = export_to_sonus(data_dir, emotion, jacket)
        print(f"Generated level with PNG jacket: {level}")

if __name__ == "__main__":
    main()