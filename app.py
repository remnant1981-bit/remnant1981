import os
from flask import Flask, render_template, request, redirect, jsonify, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta

app = Flask(__name__)

# --- 설정 ---
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
    link = db.Column(db.String(500), nullable=False)
    clicks = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    is_active = db.Column(db.Boolean, default=True)


class NaverPost(db.Model):
    """네이버 블로그 포스팅 관리 모델"""
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(300), nullable=False)
    content = db.Column(db.Text, nullable=True)
    keyword = db.Column(db.String(200), nullable=True)
    category = db.Column(db.String(100), default='일반')
    status = db.Column(db.String(20), default='draft')  # draft, scheduled, posted, failed
    scheduled_at = db.Column(db.DateTime, nullable=True)
    posted_at = db.Column(db.DateTime, nullable=True)
    post_url = db.Column(db.String(500), nullable=True)
    product_id = db.Column(db.Integer, db.ForeignKey('product.id'), nullable=True)
    product = db.relationship('Product', backref='posts')
    views = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class PostingLog(db.Model):
    """포스팅 작업 로그"""
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey('naver_post.id'), nullable=True)
    action = db.Column(db.String(50), nullable=False)  # created, scheduled, posted, failed, deleted
    message = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


with app.app_context():
    db.create_all()

# --- 기존 라우트 ---

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
            item_id=data.get('item_id'),
            title=data.get('title'),
            desc=data.get('desc'),
            image_url=data.get('image_url'),
            link=data.get('link')
        )
        db.session.add(new_product)
    db.session.commit()
    return jsonify({"status": "success", "title": data.get('title')}), 201

# --- 네이버 포스팅 대시보드 라우트 ---

@app.route('/dashboard')
def dashboard():
    """메인 대시보드"""
    # 통계
    total_posts = NaverPost.query.count()
    posted_count = NaverPost.query.filter_by(status='posted').count()
    scheduled_count = NaverPost.query.filter_by(status='scheduled').count()
    draft_count = NaverPost.query.filter_by(status='draft').count()
    failed_count = NaverPost.query.filter_by(status='failed').count()
    total_products = Product.query.count()
    total_clicks = db.session.query(db.func.sum(Product.clicks)).scalar() or 0

    # 최근 포스트
    recent_posts = NaverPost.query.order_by(NaverPost.updated_at.desc()).limit(10).all()

    # 최근 로그
    recent_logs = PostingLog.query.order_by(PostingLog.created_at.desc()).limit(15).all()

    # 오늘 포스팅 수
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_posted = NaverPost.query.filter(
        NaverPost.posted_at >= today,
        NaverPost.status == 'posted'
    ).count()

    stats = {
        'total_posts': total_posts,
        'posted': posted_count,
        'scheduled': scheduled_count,
        'draft': draft_count,
        'failed': failed_count,
        'total_products': total_products,
        'total_clicks': total_clicks,
        'today_posted': today_posted,
    }
    return render_template('dashboard.html', stats=stats, posts=recent_posts, logs=recent_logs)


@app.route('/dashboard/post/new', methods=['GET', 'POST'])
def new_post():
    """새 포스트 작성"""
    if request.method == 'POST':
        title = request.form.get('title', '').strip()
        content = request.form.get('content', '').strip()
        keyword = request.form.get('keyword', '').strip()
        category = request.form.get('category', '일반')
        product_id = request.form.get('product_id')
        action = request.form.get('action', 'draft')

        if not title:
            flash('제목을 입력해주세요.', 'error')
            return redirect(url_for('new_post'))

        post = NaverPost(
            title=title,
            content=content,
            keyword=keyword,
            category=category,
            product_id=int(product_id) if product_id else None,
        )

        if action == 'schedule':
            scheduled_str = request.form.get('scheduled_at', '')
            if scheduled_str:
                post.scheduled_at = datetime.strptime(scheduled_str, '%Y-%m-%dT%H:%M')
                post.status = 'scheduled'
            else:
                post.status = 'draft'
        else:
            post.status = 'draft'

        db.session.add(post)
        db.session.commit()

        log = PostingLog(post_id=post.id, action='created', message=f'포스트 생성: {title}')
        db.session.add(log)
        db.session.commit()

        flash('포스트가 저장되었습니다.', 'success')
        return redirect(url_for('dashboard'))

    products = Product.query.filter_by(is_active=True).order_by(Product.created_at.desc()).all()
    return render_template('post_form.html', post=None, products=products)


@app.route('/dashboard/post/<int:post_id>/edit', methods=['GET', 'POST'])
def edit_post(post_id):
    """포스트 수정"""
    post = NaverPost.query.get_or_404(post_id)

    if request.method == 'POST':
        post.title = request.form.get('title', '').strip()
        post.content = request.form.get('content', '').strip()
        post.keyword = request.form.get('keyword', '').strip()
        post.category = request.form.get('category', '일반')
        product_id = request.form.get('product_id')
        post.product_id = int(product_id) if product_id else None
        action = request.form.get('action', 'draft')

        if action == 'schedule':
            scheduled_str = request.form.get('scheduled_at', '')
            if scheduled_str:
                post.scheduled_at = datetime.strptime(scheduled_str, '%Y-%m-%dT%H:%M')
                post.status = 'scheduled'
        elif action == 'draft':
            post.status = 'draft'

        db.session.commit()
        log = PostingLog(post_id=post.id, action='updated', message=f'포스트 수정: {post.title}')
        db.session.add(log)
        db.session.commit()

        flash('포스트가 수정되었습니다.', 'success')
        return redirect(url_for('dashboard'))

    products = Product.query.filter_by(is_active=True).order_by(Product.created_at.desc()).all()
    return render_template('post_form.html', post=post, products=products)


@app.route('/dashboard/post/<int:post_id>/delete', methods=['POST'])
def delete_post(post_id):
    """포스트 삭제"""
    post = NaverPost.query.get_or_404(post_id)
    log = PostingLog(post_id=post.id, action='deleted', message=f'포스트 삭제: {post.title}')
    db.session.add(log)
    db.session.delete(post)
    db.session.commit()
    flash('포스트가 삭제되었습니다.', 'success')
    return redirect(url_for('dashboard'))


@app.route('/dashboard/post/<int:post_id>/publish', methods=['POST'])
def publish_post(post_id):
    """포스트 발행 (시뮬레이션)"""
    post = NaverPost.query.get_or_404(post_id)
    post.status = 'posted'
    post.posted_at = datetime.utcnow()
    post.post_url = f"https://blog.naver.com/post/{post.id}"
    db.session.commit()

    log = PostingLog(post_id=post.id, action='posted', message=f'포스트 발행: {post.title}')
    db.session.add(log)
    db.session.commit()
    flash('포스트가 발행되었습니다.', 'success')
    return redirect(url_for('dashboard'))


@app.route('/api/dashboard/stats')
def api_dashboard_stats():
    """대시보드 통계 API"""
    total_posts = NaverPost.query.count()
    posted = NaverPost.query.filter_by(status='posted').count()
    scheduled = NaverPost.query.filter_by(status='scheduled').count()
    draft = NaverPost.query.filter_by(status='draft').count()
    total_clicks = db.session.query(db.func.sum(Product.clicks)).scalar() or 0
    return jsonify({
        'total_posts': total_posts,
        'posted': posted,
        'scheduled': scheduled,
        'draft': draft,
        'total_clicks': total_clicks,
    })


if __name__ == '__main__':
    app.run(debug=True)
