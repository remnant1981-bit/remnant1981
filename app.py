from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_sqlalchemy import SQLAlchemy
from functools import wraps
import os
import json
import google.generativeai as genai

app = Flask(__name__)
# Secret key for session management (Keep this secret in production!)
app.secret_key = 'super_secret_key_for_demo'

# Database Configuration
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'database.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# --- Models ---
class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.String(50), unique=True, nullable=False)
    title = db.Column(db.String(100), nullable=False)
    image_url = db.Column(db.String(500))
    desc = db.Column(db.Text)
    link = db.Column(db.String(500))
    clicks = db.Column(db.Integer, default=0)

    def to_dict(self):
        return {
            'id': self.id,
            'item_id': self.item_id,
            'title': self.title,
            'image_url': self.image_url,
            'desc': self.desc,
            'link': self.link,
            'clicks': self.clicks
        }

# --- Data Seeding (Optional: Migrate old data if first run) ---
def seed_data():
    if not Product.query.first():
        # Old data from products.py
        initial_products = [
            Product(
                item_id="galaxy",
                title="Samsung Galaxy S24 Ultra",
                image_url="https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?auto=format&fit=crop&q=80&w=800",
                desc="Experience the new era of mobile AI. 200MP camera, nightography, and all-day battery life.",
                link="https://example.com/affiliate/samsung-galaxy-s24"
            ),
            Product(
                item_id="diet",
                title="Ultimate Keto Plan 30-Day Info",
                image_url="https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&q=80&w=800",
                desc="Kickstart your health journey with this comprehensive 30-day meal plan. Includes recipes and shopping lists.",
                link="https://example.com/affiliate/keto-plan"
            )
        ]
        db.session.add_all(initial_products)
        db.session.commit()
        print("Database seeded with initial products.")

# --- Admin Auth Decorator ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('admin_login'))
        return f(*args, **kwargs)
    return decorated_function

# --- Routes ---

@app.route('/')
def home():
    item_id = request.args.get('item_id')
    
    if item_id:
        product = Product.query.filter_by(item_id=item_id).first()
        if product:
            # Increment click/view count (Optional basic analytics)
            product.clicks += 1
            db.session.commit()
            return render_template('index.html', product=product)

    # Fallback / Default Content
    default_product = {
        "title": "Welcome to Our Best Deals",
        "image_url": "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&q=80&w=800",
        "desc": "Discover top-rated products at unbeatable prices. Select a category or check our latest offers below.",
        "link": "https://example.com/deals"
    }
    return render_template('index.html', product=default_product)

# --- Admin Routes ---

@app.route('/admin', methods=['GET'])
@login_required
def admin_dashboard():
    products = Product.query.all()
    return render_template('admin.html', products=products)

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if request.method == 'POST':
        password = request.form.get('password')
        if password == '1234':  # Simple hardcoded password
            session['logged_in'] = True
            return redirect(url_for('admin_dashboard'))
        else:
            return render_template('admin.html', error="Invalid Password", login_mode=True)
    return render_template('admin.html', login_mode=True)

@app.route('/admin/add', methods=['POST'])
@login_required
def admin_add_product():
    new_product = Product(
        item_id=request.form['item_id'],
        title=request.form['title'],
        image_url=request.form['image_url'],
        desc=request.form['desc'],
        link=request.form['link']
    )
    try:
        db.session.add(new_product)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        # In a real app, flash an error message
        print(f"Error adding product: {e}")
        
    return redirect(url_for('admin_dashboard'))

@app.route('/admin/delete/<int:id>', methods=['POST'])
@login_required
def admin_delete_product(id):
    product = Product.query.get_or_404(id)
    db.session.delete(product)
    db.session.commit()
    return redirect(url_for('admin_dashboard'))

# --- API Routes ---

@app.route('/api/product', methods=['POST'])
def api_add_product():
    data = request.json
    if not data:
        return jsonify({"error": "No data provided"}), 400
    
    # Basic Validation
    required_fields = ['item_id', 'title', 'link']
    for field in required_fields:
        if field not in data:
            return jsonify({"error": f"Missing field: {field}"}), 400

    new_product = Product(
        item_id=data['item_id'],
        title=data['title'],
        image_url=data.get('image_url', ''),
        desc=data.get('desc', ''),
        link=data['link']
    )
    
    try:
        db.session.add(new_product)
        db.session.commit()
        return jsonify({"message": "Product created", "product": new_product.to_dict()}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

@app.route('/admin/ai-create', methods=['POST'])
@login_required
def admin_ai_create():
    api_key = request.form.get('api_key')
    product_name = request.form.get('product_name')
    link = request.form.get('link')
    image_url = request.form.get('image_url')

    if not api_key or not product_name:
        # In real world, use flash messages
        return "API Key and Product Name are required", 400

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-pro')

        prompt = f"""
        You are a professional marketing copywriter.
        Create a JSON object for a product named "{product_name}".
        The JSON must have exactly these keys:
        - "item_id": A short, url-friendly English slug (kebab-case). Unique.
        - "title": A catchy, click-inducing title (include 1 emoji).
        - "desc": A persuasive description (3-4 sentences).

        Output ONLY the JSON string. No markdown code blocks.
        """

        response = model.generate_content(prompt)
        text_response = response.text.strip()
        
        # Clean potential markdown backticks if Gemini adds them
        if text_response.startswith('```json'):
            text_response = text_response[7:]
        if text_response.endswith('```'):
            text_response = text_response[:-3]
            
        ai_data = json.loads(text_response)

        new_product = Product(
            item_id=ai_data['item_id'],
            title=ai_data['title'],
            image_url=image_url,
            desc=ai_data['desc'],
            link=link
        )
        
        db.session.add(new_product)
        db.session.commit()
        
        return redirect(url_for('admin_dashboard'))

    except Exception as e:
        # Graceful error handling: Show error on the dashboard instead of raw 500 page
        products = Product.query.all()
        return render_template('admin.html', products=products, error=f"AI Error: {str(e)}")

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        seed_data()
    app.run(debug=True, port=5000)
