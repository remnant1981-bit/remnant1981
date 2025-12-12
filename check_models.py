import google.generativeai as genai
import sys


api_key = "AIzaSyAczWjDFBKev2oReaZ7b0toQV6t1J--ILs"
genai.configure(api_key=api_key)

print("Listing available models...")
try:
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print(m.name)
except Exception as e:
    print(f"Error: {e}")
