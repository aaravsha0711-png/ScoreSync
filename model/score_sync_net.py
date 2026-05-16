import torch
import torch.nn as nn

class ScoreSyncNet(nn.Module):
    def __init__(self, input_dim=64, hidden_dim=128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(hidden_dim, hidden_dim//2),
            nn.ReLU(),
        )
        self.pitch_head = nn.Linear(hidden_dim//2, 1)
        self.difficulty_head = nn.Linear(hidden_dim//2, 1)
        self.suggestion_head = nn.Linear(hidden_dim//2, 5)

    def forward(self, x):
        features = self.net(x)
        return {
            "pitch_error": torch.sigmoid(self.pitch_head(features)),
            "difficulty": torch.sigmoid(self.difficulty_head(features)),
            "suggestion": self.suggestion_head(features)
        }