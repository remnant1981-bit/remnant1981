# products.py
# This file stores the product data for the Bridge Page Application.
# In a real-world scenario, this could be replaced by a database query.

products = {
    "galaxy": {
        "title": "Samsung Galaxy S24 Ultra",
        "image_url": "https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?auto=format&fit=crop&q=80&w=800",
        "description": "Experience the new era of mobile AI. 200MP camera, nightography, and all-day battery life.",
        "affiliate_link": "https://example.com/affiliate/samsung-galaxy-s24",
        "price_text": "From $1,199.99"
    },
    "diet": {
        "title": "Ultimate Keto Plan 30-Day Info",
        "image_url": "https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&q=80&w=800",
        "description": "Kickstart your health journey with this comprehensive 30-day meal plan. Includes recipes and shopping lists.",
        "affiliate_link": "https://example.com/affiliate/keto-plan",
        "price_text": "Special Offer: $29.99"
    },
    # Add more products here as needed
}

# Fallback/Default content used when an invalid or missing item_id is provided
default_content = {
    "title": "Welcome to Our Best Deals",
    "image_url": "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&q=80&w=800",
    "description": "Discover top-rated products at unbeatable prices. Select a category or check our latest offers below.",
    "affiliate_link": "https://example.com/deals",
    "price_text": "Check Daily Deals"
}
