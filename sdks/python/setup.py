from setuptools import setup, find_packages
from pathlib import Path

# Read README for long_description
long_description = Path("README.md").read_text(encoding="utf-8")

setup(
    name="raceway",
    version="0.2.0",  # Bumped for decorator release
    description="Python SDK for Raceway - race condition detection and distributed tracing",
    long_description=long_description,
    long_description_content_type="text/markdown",
    author="Raceway Contributors",
    author_email="hello@raceway.dev",
    url="https://github.com/anthropics/raceway",
    project_urls={
        "Bug Tracker": "https://github.com/anthropics/raceway/issues",
        "Documentation": "https://github.com/anthropics/raceway/tree/main/sdks/python",
        "Source Code": "https://github.com/anthropics/raceway",
        "Changelog": "https://github.com/anthropics/raceway/blob/main/CHANGELOG.md",
    },

    # Package discovery - exclude tests
    packages=find_packages(exclude=("tests", "tests.*")),
    include_package_data=True,

    # Core dependencies
    install_requires=[
        "requests>=2.25.0",
    ],

    # Optional dependencies
    extras_require={
        # Web framework middleware
        "flask": [
            "flask>=2.0.0",
        ],
        "fastapi": [
            "fastapi>=0.95.0",
            "starlette>=0.26.0",
        ],
        # All web frameworks
        "web": [
            "flask>=2.0.0",
            "fastapi>=0.95.0",
            "starlette>=0.26.0",
        ],
        # Development dependencies
        "dev": [
            "pytest>=7.0.0",
            "pytest-asyncio>=0.21.0",
            "pytest-cov>=4.0.0",
            "black>=23.0.0",
            "flake8>=6.0.0",
            "mypy>=1.0.0",
        ],
        # All optional dependencies
        "all": [
            "flask>=2.0.0",
            "fastapi>=0.95.0",
            "starlette>=0.26.0",
            "pytest>=7.0.0",
            "pytest-asyncio>=0.21.0",
            "pytest-cov>=4.0.0",
            "black>=23.0.0",
            "flake8>=6.0.0",
            "mypy>=1.0.0",
        ],
    },

    python_requires=">=3.8",

    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Programming Language :: Python :: 3.13",
        "Topic :: Software Development :: Testing",
        "Topic :: System :: Distributed Computing",
        "Topic :: System :: Monitoring",
    ],

    keywords="race-conditions concurrency distributed-tracing monitoring debugging instrumentation",
)
