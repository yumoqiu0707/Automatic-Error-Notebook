/* 首次启动（data/db.json 尚不存在）时植入的 6 道示例错题：数学 3 / 物理 2 / 英语 1。
 * 全部带「示例」标签，用户可在「我的错题集」里逐条删除；删除后不会再自动补回。
 * 这里只放错题条目的展示数据，不含同类型题的锁定答案（那属于处理记录，示例不提供）。
 */
module.exports = [
  {
    "subject": "数学",
    "grade": "初二",
    "difficulty": "基础",
    "question_type": "选择题",
    "topic_path": [
      "初中数学",
      "方程与不等式",
      "一元二次方程根的判别式"
    ],
    "question": {
      "stem": "若关于 $x$ 的一元二次方程 $x^{2}-2x+m=0$ 有两个不相等的实数根，则 $m$ 的取值范围是（  ）",
      "options": [
        "A. $m<1$",
        "B. $m>1$",
        "C. $m\\le 1$",
        "D. $m\\ge 1$"
      ],
      "figure_description": "",
      "blanks": []
    },
    "user_answer": "B",
    "correct_answer": "A",
    "answer_explanation": "$\\Delta=(-2)^{2}-4\\times 1\\times m=4-4m$。方程有两个不相等的实数根等价于 $\\Delta>0$，即 $4-4m>0$，解得 $m<1$，故选 A。",
    "error_analysis": {
      "where_wrong": "由 $4-4m>0$ 变形时两边同除以 $-4$，得到 $m>1$，忘记不等号要变向。",
      "error_type": "运算错误",
      "root_cause": "不等式的基本性质掌握不牢：两边同乘或同除负数，不等号方向必须改变。",
      "knowledge_gap": [
        "不等式两边同除负数需变号",
        "判别式符号与根个数的对应关系"
      ]
    },
    "knowledge_review": {
      "definition": "一元二次方程 $ax^{2}+bx+c=0\\ (a\\neq 0)$ 的根的判别式 $\\Delta=b^{2}-4ac$ 决定实数根的个数。",
      "formulas": [
        "$\\Delta=b^{2}-4ac$",
        "$\\Delta>0$ ⇔ 两个不相等实根",
        "$\\Delta=0$ ⇔ 两个相等实根",
        "$\\Delta<0$ ⇔ 无实根"
      ],
      "conditions": [
        "先化为一般式才能读 $a,b,c$",
        "判别式只对一元二次方程成立"
      ],
      "steps": [
        "化一般式，确定 $a,b,c$（注意符号）",
        "计算 $\\Delta=b^{2}-4ac$",
        "把「根的个数」翻译成 $\\Delta$ 的不等式",
        "解出参数范围",
        "检查 $a\\neq 0$"
      ],
      "common_mistakes": [
        "解不等式两边同除负数忘记变号",
        "把 $(-2)^{2}$ 误算成 $-4$"
      ],
      "method_summary": "见「根的个数」→ 立即写 $\\Delta$ → 按不等/相等/没有翻译成 $>0$ / $=0$ / $<0$ → 解参数 → 回头查二次项系数。"
    },
    "similar_questions": [
      {
        "question_id": "m1_q1",
        "stem": "关于 $x$ 的方程 $x^{2}+4x+c=0$ 有两个不相等的实数根，则 $c$ 的取值范围是（  ）",
        "options": [
          "A. $c<4$",
          "B. $c>4$",
          "C. $c\\le 4$",
          "D. $c\\ge 4$"
        ],
        "answer_locked": true,
        "submit_required": true
      },
      {
        "question_id": "m1_q2",
        "stem": "若关于 $x$ 的一元二次方程 $2x^{2}-3x+k=0$ 有两个相等的实数根，则 $k=$ ______",
        "options": [],
        "answer_locked": true,
        "submit_required": true
      }
    ]
  },
  {
    "subject": "物理",
    "grade": "初三",
    "difficulty": "中等",
    "question_type": "计算题",
    "topic_path": [
      "初中物理",
      "电学",
      "欧姆定律"
    ],
    "question": {
      "stem": "一个阻值为 $10\\Omega$ 的定值电阻，两端电压为 $5V$，求通过它的电流。",
      "options": [],
      "figure_description": "",
      "blanks": []
    },
    "user_answer": "2A",
    "correct_answer": "$0.5A$",
    "answer_explanation": "由欧姆定律 $I=\\frac{U}{R}=\\frac{5V}{10\\Omega}=0.5A$。",
    "error_analysis": {
      "where_wrong": "代入时把 $U$ 与 $R$ 的位置写反，算成 $\\frac{10}{5}=2A$。",
      "error_type": "方法错误",
      "root_cause": "欧姆定律的三个变形没有分清哪个量在分子上。",
      "knowledge_gap": [
        "欧姆定律的三种变形",
        "单位与量纲的合理性检验"
      ]
    },
    "knowledge_review": {
      "definition": "欧姆定律：导体中的电流跟导体两端的电压成正比，跟导体的电阻成反比。",
      "formulas": [
        "$I=\\frac{U}{R}$",
        "$U=IR$",
        "$R=\\frac{U}{I}$"
      ],
      "conditions": [
        "必须是同一段导体、同一时刻",
        "公式只适用于纯电阻电路"
      ],
      "steps": [
        "找出已知量（$U$、$I$、$R$ 中的两个）",
        "选择对应的变形公式",
        "代入数值并带单位计算",
        "用量纲检验结果是否合理"
      ],
      "common_mistakes": [
        "把 $U$ 与 $R$ 写反",
        "忘记带单位",
        "电压与电阻单位不统一就直接计算"
      ],
      "method_summary": "先写公式再代数，算完用「电压大电流大、电阻大电流小」做一次合理性判断。"
    },
    "similar_questions": [
      {
        "question_id": "m1_q1",
        "stem": "阻值为 $20\\Omega$ 的电阻两端电压为 $6V$，通过它的电流为 ______",
        "options": [],
        "answer_locked": true,
        "submit_required": true
      },
      {
        "question_id": "m1_q2",
        "stem": "通过 $5\\Omega$ 电阻的电流为 $2A$，它两端的电压为 ______",
        "options": [],
        "answer_locked": true,
        "submit_required": true
      }
    ]
  },
  {
    "subject": "英语",
    "grade": "初二",
    "difficulty": "中等",
    "question_type": "单选题",
    "topic_path": [
      "初中英语",
      "语法",
      "现在完成时"
    ],
    "question": {
      "stem": "I ______ in this city since 2018.",
      "options": [
        "A. live",
        "B. lived",
        "C. have lived",
        "D. am living"
      ],
      "figure_description": "",
      "blanks": []
    },
    "user_answer": "B",
    "correct_answer": "C",
    "answer_explanation": "句中的 since 2018 表示「从 2018 年到现在」，动作从过去持续到现在，应用现在完成时 have/has + 过去分词。主语 I 用 have，故填 have lived，选 C。",
    "error_analysis": {
      "where_wrong": "看到 2018 这个过去时间，误用了般过去时 lived。",
      "error_type": "概念不清",
      "root_cause": "没有区分「过去时间点」和「since + 时间点表示持续到现在」这两种用法。",
      "knowledge_gap": [
        "现在完成时的持续用法",
        "since 与 for 的区别"
      ]
    },
    "knowledge_review": {
      "definition": "现在完成时表示过去发生的动作对现在造成的影响或从过去持续到现在的状态，结构为 have/has + 过去分词。",
      "formulas": [
        "have / has + 过去分词",
        "since + 时间点",
        "for + 时间段"
      ],
      "conditions": [
        "since 后接时间点（since 2018），for 后接时间段（for five years）",
        "句子强调对现在的影响或持续状态"
      ],
      "steps": [
        "找时间标志词（since / for / already / yet / ever / never）",
        "判断是「持续」还是「完成」用法",
        "确定主语人称选择 have 或 has",
        "核对过去分词形式"
      ],
      "common_mistakes": [
        "把 since 2018 当成一般过去时的时间状语",
        "since 与 for 混用",
        "不规则动词的过去分词写错"
      ],
      "method_summary": "看到 since / for + 现在还在持续的状态，优先想现在完成时。"
    },
    "similar_questions": [
      {
        "question_id": "m1_q1",
        "stem": "He ______ here for three years.",
        "options": [
          "A. works",
          "B. worked",
          "C. has worked",
          "D. is working"
        ],
        "answer_locked": true,
        "submit_required": true
      },
      {
        "question_id": "m1_q2",
        "stem": "They ______ each other since they were children.",
        "options": [
          "A. know",
          "B. knew",
          "C. have known",
          "D. are knowing"
        ],
        "answer_locked": true,
        "submit_required": true
      }
    ]
  },
  {
    "subject": "数学",
    "grade": "初二",
    "difficulty": "基础",
    "question_type": "解答题",
    "topic_path": [
      "初中数学",
      "数与式",
      "完全平方公式"
    ],
    "question": {
      "stem": "已知 $a+b=5$，$ab=6$，求 $a^{2}+b^{2}$ 的值。",
      "options": [],
      "figure_description": "",
      "blanks": []
    },
    "user_answer": null,
    "correct_answer": "$13$",
    "answer_explanation": "$a^{2}+b^{2}=(a+b)^{2}-2ab=5^{2}-2\\times 6=25-12=13$。",
    "error_analysis": {
      "where_wrong": "未识别到你的作答，请补充你的答案后再分析错因。",
      "error_type": "其他",
      "root_cause": "本题尚未识别到作答内容。",
      "knowledge_gap": [
        "完全平方公式的变形"
      ]
    },
    "knowledge_review": {
      "definition": "完全平方公式 $(a\\pm b)^{2}=a^{2}\\pm 2ab+b^{2}$，变形可得 $a^{2}+b^{2}=(a+b)^{2}-2ab$。",
      "formulas": [
        "$(a+b)^{2}=a^{2}+2ab+b^{2}$",
        "$a^{2}+b^{2}=(a+b)^{2}-2ab$"
      ],
      "conditions": [
        "公式对任意实数成立"
      ],
      "steps": [
        "观察已知与所求",
        "选择合适的变形公式",
        "代入求值"
      ],
      "common_mistakes": [
        "直接展开 $(a+b)^2$ 后忘记减去 $2ab$"
      ],
      "method_summary": "见平方和与乘积，优先想完全平方公式的变形。"
    },
    "similar_questions": [
      {
        "question_id": "m1_q1",
        "stem": "已知 $x+y=7$，$xy=10$，则 $x^{2}+y^{2}=$ ______",
        "options": [],
        "answer_locked": true,
        "submit_required": true
      },
      {
        "question_id": "m1_q2",
        "stem": "已知 $m-n=3$，$mn=4$，则 $m^{2}+n^{2}=$ ______",
        "options": [],
        "answer_locked": true,
        "submit_required": true
      }
    ]
  },
  {
    "subject": "数学",
    "grade": "初二",
    "difficulty": "困难",
    "question_type": "填空题",
    "topic_path": [
      "初中数学",
      "方程与不等式",
      "分式方程的增根"
    ],
    "question": {
      "stem": "若关于 $x$ 的分式方程 $\\frac{2}{x-3}=\\frac{m}{x-3}+1$ 无解，则 $m=$ ______",
      "options": [],
      "figure_description": "",
      "blanks": []
    },
    "user_answer": "3",
    "correct_answer": "$m=2$",
    "answer_explanation": "去分母得 $2=m+(x-3)$，即 $x=5-m$。方程无解有两种情形：① 整式方程无解；② 解使最简公分母为 0，即 $x=3$。由 $5-m=3$ 得 $m=2$，此时原方程无解。",
    "error_analysis": {
      "where_wrong": "直接把 $x=3$ 代入原方程得到 $m=3$，没有先去分母求出 $x$ 与 $m$ 的关系。",
      "error_type": "方法错误",
      "root_cause": "没有掌握「分式方程无解 = 整式方程无解 或 产生增根」这一判定框架。",
      "knowledge_gap": [
        "分式方程增根的判定",
        "含参方程的分类讨论"
      ]
    },
    "knowledge_review": {
      "definition": "分式方程的增根是去分母后整式方程的根，但它使最简公分母为 0，因此不是原方程的根。",
      "formulas": [
        "最简公分母 $=0$ ⇒ 增根",
        "整式方程无解 ⇒ 原方程无解"
      ],
      "conditions": [
        "必须先确定最简公分母",
        "「无解」包含「无实数根」和「全是增根」两种情形"
      ],
      "steps": [
        "找最简公分母，令其为 0 求出可能的增根",
        "去分母得到整式方程",
        "用含参式子表示 $x$",
        "令 $x$ = 增根，解出参数",
        "检验整式方程是否本身无解"
      ],
      "common_mistakes": [
        "漏掉「整式方程本身无解」这一情形",
        "求出参数后没有回代检验"
      ],
      "method_summary": "「无解」二字要分两步走：先看会不会产生增根，再看整式方程本身有没有解。"
    },
    "similar_questions": [
      {
        "question_id": "m3_q1",
        "stem": "若关于 $x$ 的方程 $\\frac{a}{x-2}+3=\\frac{1-x}{x-2}$ 有增根，则 $a=$ ______",
        "options": [],
        "answer_locked": true,
        "submit_required": true
      },
      {
        "question_id": "m3_q2",
        "stem": "若关于 $x$ 的分式方程 $\\frac{x}{x-4}=\\frac{k}{x-4}$ 无解，则 $k=$ ______",
        "options": [],
        "answer_locked": true,
        "submit_required": true
      }
    ]
  },
  {
    "subject": "物理",
    "grade": "初三",
    "difficulty": "中等",
    "question_type": "计算题",
    "topic_path": [
      "初中物理",
      "电学",
      "电功率"
    ],
    "question": {
      "stem": "一个标有「$220V\\ 1000W$」的电热水壶，正常工作时的电流约为多少？",
      "options": [],
      "figure_description": "",
      "blanks": []
    },
    "user_answer": "2.2A",
    "correct_answer": "$4.5A$",
    "answer_explanation": "由 $P=UI$ 得 $I=\\frac{P}{U}=\\frac{1000W}{220V}\\approx 4.5A$。",
    "error_analysis": {
      "where_wrong": "把 220 与 1000 的位置写反，算成 $\\frac{220}{1000}=0.22$ 后又错写成 2.2A。",
      "error_type": "方法错误",
      "root_cause": "电功率公式的三个变形没有分清分子分母。",
      "knowledge_gap": [
        "$P=UI$ 的变形",
        "额定电压与额定功率的含义"
      ]
    },
    "knowledge_review": {
      "definition": "电功率表示电流做功的快慢，额定电压与额定功率是铭牌上标注的正常工作参数。",
      "formulas": [
        "$P=UI$",
        "$I=\\frac{P}{U}$",
        "$U=\\frac{P}{I}$"
      ],
      "conditions": [
        "「正常工作」指在额定电压下工作，此时功率等于额定功率"
      ],
      "steps": [
        "从铭牌读出额定电压与额定功率",
        "选择 $I=\\frac{P}{U}$",
        "代入计算并保留合理位数"
      ],
      "common_mistakes": [
        "把 $U$ 与 $P$ 写反",
        "忽略「正常工作」这个前提"
      ],
      "method_summary": "「220V 1000W」= 额定电压 220V、额定功率 1000W，求电流直接用 $I=P/U$。"
    },
    "similar_questions": [
      {
        "question_id": "p2_q1",
        "stem": "一个标有「$220V\\ 440W$」的电风扇，正常工作时的电流为 ______",
        "options": [],
        "answer_locked": true,
        "submit_required": true
      },
      {
        "question_id": "p2_q2",
        "stem": "某电灯正常工作电流为 $0.5A$，额定功率为 $110W$，其额定电压为 ______",
        "options": [],
        "answer_locked": true,
        "submit_required": true
      }
    ]
  }
];
