# ScoreSync - Music Practice Application

A comprehensive music practice application with real-time pitch detection, score analysis, and interactive training features.

## Features Implemented

### Core Features
- **Real-time Pitch Detection**: Uses Web Audio API with YIN algorithm for accurate pitch tracking
- **Auto-scroll**: Automatically scrolls the score as you play
- **Rest Alerts**: Alerts you before rests in the music
- **Tempo Prompter**: Interactive tempo setting with visual feedback
- **Training Mode**: Practice with synthesized playback and segment control

### New Interactive Features
- **Marking Suggestions**: AI-powered suggestions for musical markings (dynamics, articulation, tempo changes)
- **Sticky Notes**: Click-to-add notes directly on the score for personal annotations
- **Voice Measure Jumping**: Voice commands to jump to specific measures ("measure 5", "go to measure 12")
- **Metronome**: Integrated metronome with customizable tempo and time signatures

### Optional Settings
All new features can be toggled on/off in the settings panel:
- Marking suggestions
- Sticky notes
- Voice measure jumping
- Rest alerts with configurable advance warning
- Metronome controls

## File Structure

```
ScoreSync/
├── main.py                 # FastAPI backend entry point
├── score-reader.jsx        # Main React application
├── main.jsx               # React app entry point
├── scores.py              # Score processing endpoints
├── playback.py            # Metronome and audio generation
├── profile.py             # User profile management
├── database.py            # SQLite database layer
├── deps.py                # FastAPI dependencies
├── security.py            # JWT authentication
├── stylistic.py           # MusicXML analysis
├── transposition.py       # Instrument transposition
└── musescore_converter.py # MuseScore file conversion
```

## Setup Instructions

### Backend Requirements
- Python 3.7+ (current environment has Python 3.4 - upgrade required)
- FastAPI
- Uvicorn
- SQLite3
- Additional dependencies for music processing

### Frontend Requirements
- React 16+
- Modern browser with Web Audio API support
- Speech Recognition API (Chrome recommended)

### Running the Application

1. **Upgrade Python** (if using Python 3.4):
   ```bash
   # Install Python 3.8+ from python.org or your package manager
   python --version  # Should show 3.8 or higher
   ```

2. **Install Backend Dependencies**:
   ```bash
   pip install fastapi uvicorn python-multipart sqlalchemy
   # Additional music processing libraries may be needed
   ```

3. **Initialize Database**:
   ```bash
   python -c "from database import init_db; init_db()"
   ```

4. **Start Backend**:
   ```bash
   python main.py
   # Or: uvicorn main:app --reload
   ```

5. **Serve Frontend**:
   - Open `main.jsx` in a browser, or
   - Use a React development server if available

## Usage

1. **Load a Score**: Upload PDF or MusicXML files
2. **Calibrate**: Run through the pitch calibration process
3. **Practice**: Start microphone and play along with auto-scroll
4. **Use Features**:
   - Enable metronome in the metronome tab
   - Add sticky notes by clicking the sticky note button
   - Voice commands work when microphone is active
   - Check marking suggestions in the markings tab

## Browser Compatibility

- **Recommended**: Chrome/Edge (full Web Audio and Speech API support)
- **Supported**: Firefox, Safari (limited speech recognition)
- **Not Supported**: Mobile browsers (Web Audio API limitations)

## Troubleshooting

### Backend Issues
- **Python version error**: Upgrade to Python 3.7+
- **Import errors**: Install missing dependencies with pip
- **Database errors**: Run database initialization

### Frontend Issues
- **Microphone not working**: Grant microphone permissions
- **Speech recognition not working**: Use Chrome browser
- **Audio not playing**: Check browser audio settings

## Development Notes

The application uses modern web technologies:
- React Hooks for state management
- Web Audio API for real-time audio processing
- Speech Recognition API for voice commands
- Canvas-based score rendering with OpenSheetMusicDisplay
- FastAPI for RESTful backend services

All new features are optional and can be disabled in settings for a cleaner interface.</content>
<parameter name="filePath">c:\Users\anura\.idlerc\ScoreSync\README.md