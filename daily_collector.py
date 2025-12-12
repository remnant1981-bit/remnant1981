import time
import requests
import json
import google.generativeai as genai
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager

# --- Configuration ---
GEMINI_API_KEY = "AIzaSyAczWjDFBKev2oReaZ7b0toQV6t1J--ILs" # Using the provided key
LOCAL_API_URL = "http://127.0.0.1:5000/api/product"
TARGET_URL = "https://search.shopping.naver.com/best/home" # Naver Shopping Best (More stable than Coupang for bots)

# --- Gemini Setup ---
genai.configure(api_key=GEMINI_API_KEY)
# Using gemini-pro (v1.0) as it was confirmed working in previous steps
model = genai.GenerativeModel('gemini-pro')

def setup_driver():
    chrome_options = Options()
    chrome_options.add_argument("--headless") # Run in background
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    # Stealth User-Agent
    chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36")
    
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=chrome_options)
    return driver

def generate_marketing_copy(product_name):
    try:
        prompt = f"""
        You are a viral marketing expert.
        Create a JSON object for a product named "{product_name}".
        Keys:
        - "item_id": A short english slug (kebab-case).
        - "title": A click-bait style title with 1 emoji.
        - "desc": 3 sentences explaining why this is a 'must-buy'.

        Output ONLY JSON.
        """
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        # Clean markdown
        if text.startswith('```json'): text = text[7:]
        if text.endswith('```'): text = text[:-3]
        
        return json.loads(text)
    except Exception as e:
        print(f"  [AI Error] {e}")
        return None

def upload_to_server(data):
    try:
        res = requests.post(LOCAL_API_URL, json=data)
        if res.status_code == 201:
            print(f"  [Upload] Success! ID: {data['item_id']}")
        else:
            print(f"  [Upload] Failed: {res.text}")
    except Exception as e:
        print(f"  [Network Error] {e}")

def main():
    print(">>> Starting Daily Collector Bot...")
    driver = setup_driver()
    
    try:
        print(f">>> Accessing {TARGET_URL}...")
        driver.get(TARGET_URL)
        time.sleep(5) # Increased wait

        # Try multiple selectors for Naver Best
        selectors = [
            "li[class^='imageProduct_item__']",
            "li[class^='product_item__']", 
            "div[class^='product_item__']",
            "ul > li > div > a[class^='product_link__']", # Try finding links directly
            ".chartList_item__1hFb2" # Specific known class (example)
        ]
        
        items = []
        for sel in selectors:
            found = driver.find_elements(By.CSS_SELECTOR, sel)
            if found:
                items = found
                print(f"  [Debug] Found {len(items)} items using selector: {sel}")
                break
        
        # Super fallback: Just get all links that look like products
        if not items:
            print("  [Debug] fallback to generic link search")
            items = driver.find_elements(By.XPATH, "//a[contains(@href, 'cr.shopping.naver.com') or contains(@class, 'linkAnchor')]")[:5]

        print(f">>> Found {len(items)} items. Processing top 5...")

        count = 0
        for item in items:
            if count >= 5: break
            
            try:
                # Extract Data - Validation needed because 'item' might be <li> or <a>
                tag_name = item.tag_name.lower()
                
                if tag_name == 'a':
                    link = item.get_attribute("href")
                    # Try to find title/image nearby or inside
                    try:
                        raw_title = item.text or item.get_attribute("title") or "Hot Item"
                    except: raw_title = "Hot Item"
                    image_url = "" # Simplify for fallback
                else:
                    # It's a container (li/div)
                    try:
                        title_el = item.find_element(By.CSS_SELECTOR, "strong, div[class*='title'], a[class*='link']")
                        raw_title = title_el.text
                    except: raw_title = "Hot Item"

                    try:
                        link_el = item.find_element(By.TAG_NAME, "a")
                        link = link_el.get_attribute("href")
                    except: link = "http://shopping.naver.com"

                    try:
                        img_el = item.find_element(By.TAG_NAME, "img")
                        image_url = img_el.get_attribute("src")
                    except: image_url = ""


                print(f"\n[{count+1}/5] Processing: {raw_title}")
                
                # AI Processing
                ai_data = generate_marketing_copy(raw_title)
                
                if ai_data:
                    # Merge Data
                    payload = {
                        "item_id": ai_data['item_id'],
                        "title": ai_data['title'],
                        "desc": ai_data['desc'],
                        "link": link,
                        "image_url": image_url
                    }
                    
                    # Upload
                    upload_to_server(payload)
                    count += 1
                
                time.sleep(1) # Polite delay

            except Exception as e:
                print(f"  [Skipping] Error parsing item: {e}")
                continue

    except Exception as e:
        print(f">>> Critical Crawler Error: {e}")
    finally:
        driver.quit()
        print(">>> Bot Finished.")

if __name__ == "__main__":
    main()
