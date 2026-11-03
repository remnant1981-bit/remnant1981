import os
import google.generativeai as genai
import sys

api_key = os.environ.get("GEMINI_API_KEY")  # 환경변수로 설정 (키 하드코딩 금지)
if not api_key:
    sys.exit("환경변수 GEMINI_API_KEY 설정 필요")
genai.configure(api_key=api_key)

print("Listing available models START")
try:
    for m in genai.list_models():
        print(f"Model: {m.name}")
        print(f"Methods: {m.supported_generation_methods}")
        print("-" * 20)
except Exception as e:
    print(f"Error: {e}")
print("Listing available models END")
