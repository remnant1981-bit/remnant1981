import google.generativeai as genai
import sys

api_key = "AIzaSyAczWjDFBKev2oReaZ7b0toQV6t1J--ILs"
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
