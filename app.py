import os
from flask import Flask, render_template, request, redirect, jsonify, url_for
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

app = Flask(__name__)

# --- 설정 ---
# Render 배포 환경과 로컬 환경 호환
db_url = os.environ.get('DATABASE_URL', 'sqlite:///database.db')
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

app.config['SQLALCHEMY_DATABASE_URI'] = db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'hooni_secret_key')

db = SQLAlchemy(app)

# --- DB 모델 ---
class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.String(100), unique=True, nullable=False)
    title = db.Column(db.String(200), nullable=False)
    desc = db.Column(db.Text, nullable=True)
    image_url = db.Column(db.String(500), nullable=True)
    link = db.Column(db.String(500), nullable=False) # 실제 구매 링크
    clicks = db.Column(db.Integer, default=0) # 클릭 수 추적
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_active = db.Column(db.Boolean, default=True)

with app.app_context():
    db.create_all()

# --- 라우트 ---

@app.route('/')
def index():
    products = Product.query.filter_by(is_active=True).order_by(Product.created_at.desc()).all()
    return render_template('index.html', products=products)

@app.route('/go/<item_id>')
def go_link(item_id):
    product = Product.query.filter_by(item_id=item_id).first()
    if product:
        product.clicks += 1
        db.session.commit()
        return redirect(product.link)
    return redirect(url_for('index'))

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    if request.method == 'POST':
        action = request.form.get('action')
        p_id = request.form.get('id')
        
        if action == 'delete':
            Product.query.filter_by(id=p_id).delete()
        elif action == 'update_link':
            new_link = request.form.get('link')
            product = Product.query.filter_by(id=p_id).first()
            if product:
                product.link = new_link
        
        db.session.commit()
        return redirect('/admin')

    products = Product.query.order_by(Product.created_at.desc()).all()
    return render_template('admin.html', products=products)

@app.route('/api/product', methods=['POST'])
def api_add_product():
    data = request.json
    existing = Product.query.filter_by(item_id=data.get('item_id')).first()
    
    if existing:
        existing.title = data.get('title')
        existing.desc = data.get('desc')
        existing.image_url = data.get('image_url')
        existing.link = data.get('link')
    else:
        new_product = Product(
            item_id = data.get('item_id'),
            title = data.get('title'),
            desc = data.get('desc'),
            image_url = data.get('image_url'),
            link = data.get('link')
        )
        db.session.add(new_product)
    
    db.session.commit()
    return jsonify({"status": "success", "title": data.get('title')}), 201

if __name__ == '__main__':
    app.run(debug=True)
