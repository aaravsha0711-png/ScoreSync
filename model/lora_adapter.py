from peft import LoraConfig, get_peft_model
from model.score_sync_net import ScoreSyncNet
from storage.s3_storage import S3Storage

class ScoreSyncLoRA:
    def __init__(self):
        self.base_model = ScoreSyncNet()
        self.s3 = S3Storage()
        self.active_adapter = None
        self.adapters = {}

    def create_adapter(self, name: str):
        config = LoraConfig(r=8, lora_alpha=16, target_modules=["net.0", "net.3"], lora_dropout=0.05)
        peft_model = get_peft_model(self.base_model, config)
        self.adapters[name] = peft_model
        self.active_adapter = name
        print(f"✅ LoRA Adapter created: {name}")

    def save_adapter(self, name: str):
        path = f"models/lora/{name}"
        if name in self.adapters:
            self.adapters[name].save_pretrained(path)
            self.s3.upload(f"{path}/adapter_model.bin", f"models/lora/{name}/adapter_model.bin")
            print(f"✅ Adapter {name} saved to S3")