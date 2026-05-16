import pretty_midi
from midiutil import MIDIFile

STANDARD_TUNING = [40, 45, 50, 55, 59, 64]

def process_guitar_input(input_dir):
    midi = MIDIFile(1)
    midi.addTempo(0, 0, 120)
    track = 0
    channel = 0
    time = 0
    duration = 1
    volume = 100
    for i, pitch in enumerate([60, 62, 64, 65]):
        midi.addNote(track, channel, pitch, time + i*0.5, duration, volume)
    output = f"{input_dir}/guitar_output.mid"
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    with open(output, "wb") as f:
        midi.writeFile(f)
    return output