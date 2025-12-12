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
# [보안 경고] 이 키가 외부에 노출되었으므로, 테스트 후 구글 AI Studio에서 새로 발급받으시길 권장합니다.
GEMINI_API_KEY = "AIzaSyAczWjDFBKev2oReaZ7b0toQV6t1J--ILs" 
LOCAL_API_URL = "https://hooni-pick.onrender.com/api/product"
TARGET_URL = "https://search.shopping.naver.com/best/home" # 네이버 쇼핑 베스트

# --- Gemini Setup ---
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-pro')

def setup_driver():
    """셀레니움 드라이버 설정 (봇 탐지 우회 옵션 포함)"""
    chrome_options = Options()
    # chrome_options.add_argument("--headless") # 브라우저를 보고 싶으면 주석 처리하세요
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
    chrome_options.add_argument("--window-size=1920,1080")
    
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=chrome_options)
    return driver

def generate_marketing_copy(product_name):
    """Gemini에게 마케팅 문구 생성을 요청하는 함수"""
    try:
        prompt = f"""
        너는 전문 쇼핑몰 마케터야. 다음 상품명을 보고 매력적인 마케팅 정보를 JSON 형식으로만 답해줘.
        
        상품명: {product_name}
        
        [필수 포함 항목]
        1. item_id: 상품명을 영문/숫자로 변환한 고유 ID (공백은 하이픈으로)
        2. title: 클릭을 부르는 자극적인 제목 (이모지 포함)
        3. desc: 사고 싶게 만드는 3줄 요약 설명
        
        응답은 오직 JSON만 출력해.
        """
        response = model.generate_content(prompt)
        # JSON 파싱 시도 (가끔 텍스트가 섞일 수 있어 처리)
        text = response.text.replace("```json", "").replace("```", "").strip()
        return json.loads(text)
    except Exception as e:
        print(f"⚠️ AI 생성 실패: {e}")
        return None

def upload_to_server(data):
    """Render 서버로 데이터 전송"""
    try:
        headers = {'Content-Type': 'application/json'}
        response = requests.post(LOCAL_API_URL, json=data, headers=headers)
        if response.status_code == 201 or response.status_code == 200:
            print(f"✅ 업로드 성공: {data['title']}")
        else:
            print(f"❌ 업로드 실패 ({response.status_code}): {response.text}")
    except Exception as e:
        print(f"❗ 서버 통신 오류: {e}")

def main():
    print(">>> Daily Collector Bot 시작합니다...")
    driver = setup_driver()
    
    try:
        print(f">>> {TARGET_URL} 접속 중...")
        driver.get(TARGET_URL)
        time.sleep(5) # 페이지 로딩 대기 (3초 -> 5초로 여유롭게)

        # 네이버 쇼핑 베스트 아이템 찾기 (Selectors)
        # 다양한 클래스명 패턴에 대응하도록 여러 셀렉터 준비
        selectors = [
            "li[class^='imageProduct_item']",      # 이미지 중심 뷰
            "li[class^='product_item']",           # 리스트 뷰
            "div[class*='chart_list'] li",         # 차트 리스트 (사용자님 코드)
            "ul > li > div > a[class^='product_link']", # 링크 직접 공략
            ".chartList_item__1hFb2"               # 고정 클래스 (가끔 유효)
        ]

        items = []
        for sel in selectors:
            found = driver.find_elements(By.CSS_SELECTOR, sel)
            if found:
                items = found
                print(f">>> [최적화] 셀렉터 적중: '{sel}' ({len(items)}개 발견)")
                break

        if not items:
            # 강력한 백업 전략 (XPath로 구조 검색)
            print(">>> [주의] 일반 셀렉터 실패. 구조 기반 검색 시도...")
            items = driver.find_elements(By.XPATH, "//ul/li[.//a[contains(@class, 'linkAnchor')] or .//div[contains(@class, 'title')]]")[:10]

        print(f">>> 상품 {len(items)}개 발견. 상위 5개만 처리합니다.")

        count = 0
        for item in items:
            if count >= 5: break
            
            try:
                # 1. 정보 추출 (Text & Link)
                try:
                    # 제목 요소 찾기 (다양한 후보군)
                    title_candidates = item.find_elements(By.CSS_SELECTOR, "strong, div[class*='title'], a[class*='linkAnchor']")
                    raw_title = ""
                    for cand in title_candidates:
                        if len(cand.text) > 5:
                            raw_title = cand.text.strip()
                            break
                    
                    if not raw_title: # 여전히 없으면 전체 텍스트
                         raw_title = item.text.split('\n')[0]

                    # 링크 찾기
                    link_element = item.find_element(By.TAG_NAME, "a")
                    link = link_element.get_attribute("href")
                except Exception as e:
                    print(f"  [오류] 정보 추출 실패: {e}")
                    continue

                # 2. 이미지 추출 (Image)
                try:
                    img_element = item.find_element(By.TAG_NAME, "img")
                    image_url = img_element.get_attribute("src")
                except:
                    image_url = "https://placehold.co/600x400?text=No+Image"


                if not raw_title or len(raw_title) < 2: continue

                print(f"\n[{count+1}/5] 처리 중: {raw_title[:15]}...")
                
                # 3. AI 마케팅 문구 생성
                ai_data = generate_marketing_copy(raw_title)
                
                # 4. 데이터 조립
                payload = {
                    "item_id": ai_data.get('item_id', f"item-{int(time.time())}") if ai_data else f"item-{int(time.time())}",
                    "title": ai_data.get('title', raw_title) if ai_data else raw_title,
                    "desc": ai_data.get('desc', "MD 추천 상품입니다.") if ai_data else "MD 추천 상품",
                    "link": link,
                    "image_url": image_url
                }
                
                # 5. 서버 전송
                upload_to_server(payload)
                count += 1
                time.sleep(2) # 봇 탐지 방지용 딜레이

            except Exception as e:
                print(f" ⚠️ 상품 처리 중 건너뜀: {e}")
                continue

    except Exception as e:
        print(f">>> 크리티컬 에러: {e}")
    finally:
        driver.quit()
        print(">>> 봇 종료.")

if __name__ == "__main__":
    main()
