"""Configuration is explicit; live mode never silently becomes mock mode."""
import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Settings:
    mock: bool = False
    agent_key: str = ''
    gemini_api_key: str = ''
    mongodb_uri: str = ''
    mongodb_database: str = 'showme'
    public_base_url: str = 'http://localhost:5173'
    line_number: str = ''
    gemini_model: str = 'gemini-3.1-flash-lite'
    check_timeout: float = 5.0
    crop_box: tuple | None = None
    mock_result: str = 'passed'

    @classmethod
    def from_env(cls):
        load_dotenv(ROOT / '.env')
        load_dotenv(Path(__file__).with_name('.env'))
        box = os.getenv('VISION_CROP_BOX', '')
        return cls(mock=os.getenv('MOCK') == '1', agent_key=os.getenv('AGENT_KEY', ''),
                   gemini_api_key=os.getenv('GEMINI_API_KEY', ''), mongodb_uri=os.getenv('MONGODB_URI', ''),
                   mongodb_database=os.getenv('MONGODB_DATABASE', 'showme'),
                   public_base_url=os.getenv('PUBLIC_BASE_URL', 'http://localhost:5173').rstrip('/'),
                   line_number=os.getenv('LINE_NUMBER', ''), gemini_model=os.getenv('GEMINI_MODEL', 'gemini-3.1-flash-lite'),
                   check_timeout=float(os.getenv('CHECK_TIMEOUT_SECONDS', '5')),
                   crop_box=tuple(map(int, box.split(','))) if box else None,
                   mock_result=os.getenv('MOCK_RESULT', 'passed'))
