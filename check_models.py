import os
import google.generativeai as genai
import sys


api_key = os.environ.get("GEMINI_API_KEY")  # 환경변수로 설정 (키 하드코딩 금지)
if not api_key:
    sys.exit("환경변수 GEMINI_API_KEY 설정 필요")
genai.configure(api_key=api_key)

print("Listing available models...")
try:
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print(m.name)
except Exception as e:
    print(f"Error: {e}")
