import streamlit as st
import requests
import pandas as pd
import re

API_URL = "https://c0feinpvm5.execute-api.eu-central-1.amazonaws.com/prod/documents"

st.set_page_config(
    page_title="FMS AI Audit Dashboard",
    layout="wide"
)

st.title("📊 FMS AI Audit Dashboard")


def split_sections(markdown_text):
    parts = re.split(r"\n(?=# \d+\. )", markdown_text)
    return [p.strip() for p in parts if p.strip()]


def remove_first_heading(section_text):
    lines = section_text.splitlines()

    if lines and lines[0].startswith("# "):
        return "\n".join(lines[1:]).strip()

    return section_text


try:
    with st.spinner("Loading reports..."):
        response = requests.get(API_URL, timeout=30)

    if response.status_code != 200:
        st.error(f"API Error: {response.status_code}")
        st.code(response.text)
        st.stop()

    data = response.json()

    if not data:
        st.warning("No reports found")
        st.stop()

    df = pd.DataFrame(data)

    if "created_at" in df.columns:
        df = df.sort_values("created_at", ascending=False)

    st.success(f"{len(df)} Reports Found")

    display_columns = [
        col for col in [
            "document_id",
            "status",
            "source_file",
            "summary_file",
            "created_at",
            "total_sections",
            "sections_completed",
        ]
        if col in df.columns
    ]

    st.dataframe(
        df[display_columns],
        use_container_width=True
    )

    if "status" in df.columns:
        completed_df = df[df["status"] == "COMPLETED"]
    else:
        completed_df = df

    if completed_df.empty:
        st.warning("No completed reports available yet.")
        st.stop()

    selected_doc = st.selectbox(
        "Select Completed Document",
        completed_df["document_id"].tolist()
    )

    selected_row = completed_df[
        completed_df["document_id"] == selected_doc
    ].iloc[0]

    st.info(f"Selected report status: {selected_row.get('status', 'Unknown')}")

    if st.button("View Full Report"):
        report_url = f"{API_URL}/{selected_doc}"

        with st.spinner("Loading full audit report..."):
            report_response = requests.get(report_url, timeout=30)

        if report_response.status_code != 200:
            st.error(f"Report API Error: {report_response.status_code}")
            st.code(report_response.text)
            st.stop()

        report = report_response.json()

        summary_content = report.get("summary_content")

        if not summary_content:
            st.error("summary_content missing in API response")
            st.json(report)
            st.stop()

        st.success("Report Loaded Successfully")

        st.download_button(
            label="⬇️ Download Markdown Report",
            data=summary_content,
            file_name=f"{selected_doc}_audit_report.md",
            mime="text/markdown"
        )

        sections = split_sections(summary_content)

        st.subheader("📑 Report Sections")

        for section in sections:
            first_line = section.splitlines()[0].replace("#", "").strip()

            if first_line.startswith("Professional Audit Review Report"):
                st.markdown(section)
            else:
                section_body = remove_first_heading(section)

                with st.expander(first_line, expanded=first_line.startswith("1.")):
                    st.markdown(section_body)

except Exception as e:
    st.error("Dashboard Error")
    st.exception(e)